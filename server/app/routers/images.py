"""/api/images/* 路由

任务化生图链路（解决前端刷新丢结果的 bug）：
  1. /generate /edit 接收 conversation_id，在事务内插入一条 status='pending' 的 ai message
  2. asyncio.create_task 启动后台任务调上游，task 自带 db session 与请求生命周期解耦
  3. 接口立即返回 pending message —— 前端拿到 id 即可关闭等待，开始轮询
  4. 后台任务回写 message（done + image_urls / failed + 错误文本），同时 bump conversation.updated_at
  5. 前端通过 GET /api/conversations/{id} 拉详情看到 status 变化
  6. 即使前端刷新断开连接，后台任务已经脱钩仍会跑完，刷新后看到 done 的 message

multipart /edit：字节在 endpoint 内同步读完后传入 task，避免 task 内访问已关闭的 stream。

注意：此模块**不能加 `from __future__ import annotations`**。
slowapi 的 @limiter.limit 装饰器用 functools.wraps 但保留的 __globals__ 是 slowapi 模块的，
pydantic 在 FastAPI 路由 schema 生成时去 resolve "GenerateRequest" 字符串注解会找不到名字，
导致启动崩溃（pydantic.errors.PydanticUndefinedAnnotation）。
Python 3.13 已原生支持 list[X] / X | Y 语法，不需要 future。
"""

import asyncio
import base64
import binascii
import json
import logging
import mimetypes
import re
import secrets
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db, get_session_factory
from ..deps import get_current_user
from ..audit_service import InsufficientCreditsError, apply_credit_delta
from ..email_verification_service import require_verified_user
from ..generated_assets_service import persist_generated_assets
from ..models import Conversation, Message, User
from ..openai_client import (
    UpstreamError,
    UpstreamTimeout,
    call_images_edit,
    call_images_generate,
)
from ..rate_limit import get_limiter, user_id_key
from ..redis_client import cache_image_get, cache_image_set
from ..schemas import (
    ErrorDetail,
    ErrorResponse,
    GenerateRequest,
    MessageOut,
    SegmentRequest,
)
from ..segment_service import fetch_image_bytes, segment_brush_mobile_sam, segment_sync

limiter = get_limiter()

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/images", tags=["images"])

# asyncio.create_task 仅持有 weak ref，task 可能在执行中被 GC 回收 ——
# 导致 pending message 永远不会被 task 回写为 done，前端轮询永远拿不到结果。
# 用 module-level set 保留强引用，task 完成后 done_callback 自动 discard。
# 参考 Python 3.11+ asyncio 文档对 create_task 的明确警告。
_background_tasks: set[asyncio.Task] = set()


def _spawn_background_task(coro) -> asyncio.Task:
    """启动后台 task 并保留强引用，避免被 GC 提前回收"""
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


# ===== helpers =====


# ===== 积分计费 =====
# 生图成本：1 分/张（与 SIGNUP_BONUS_CREDITS=5 对齐：新用户能生 5 张）
# 预扣 + 失败退款模型：
#   1. 请求层 check 余额、扣分、写 reason='generate'/'edit' 流水（与 ai_pending_msg 同事务）
#   2. 后台任务失败时 _refund_credits 加回 + 写 reason='refund' 流水
#   3. 成功路径不需要再扣，预扣已经搞定


def _calculate_cost(n: int) -> int:
    """每张图 1 分，最少 1"""
    return max(1, n)


async def _charge_credits(
    db: AsyncSession,
    user: User,
    cost: int,
    ai_msg_id: int,
    reason: str,
    request: Request | None = None,
) -> None:
    """原子预扣：UPDATE ... WHERE credits >= cost，行数为 0 则余额不足。

    用 SQL 原子操作替代 Python 层读-改-写，彻底消除并发竞态：
    多个请求同时扣费时，数据库串行执行 UPDATE，每个请求看到的都是上一个请求提交后的最新余额。
    """
    try:
        await apply_credit_delta(
            db,
            user_id=user.id,
            delta=-cost,
            reason=reason,
            ref_type="message",
            ref_id=str(ai_msg_id),
            note=f"{reason} {cost} 张",
            request=request,
        )
    except InsufficientCreditsError as e:
        raise _insufficient_credits(current=e.current, need=e.need) from e
    await db.refresh(user)


async def _refund_credits(
    factory,
    user_id: int,
    ai_msg_id: int,
    cost: int,
    fail_reason: str,
) -> None:
    """后台任务失败时退款：原子加回 user.credits + 写 reason='refund' 流水。独立 session。"""
    async with factory() as db:
        try:
            await apply_credit_delta(
                db,
                user_id=user_id,
                delta=cost,
                reason="refund",
                ref_type="message",
                ref_id=str(ai_msg_id),
                note=f"生图失败退款：{fail_reason}",
            )
            await db.commit()
        except Exception:  # noqa: BLE001
            await db.rollback()
            logger.exception("refund 写库失败 user_id=%s ai_msg_id=%s", user_id, ai_msg_id)


def _insufficient_credits(current: int, need: int) -> HTTPException:
    return HTTPException(
        status_code=402,
        detail={
            "error": {
                "code": "insufficient_credits",
                "message": f"积分不足：需要 {need}，当前 {current}",
                "current": current,
                "need": need,
            }
        },
    )


def _to_msg_out(m: Message) -> MessageOut:
    return MessageOut(
        id=m.id,
        role=m.role,
        text=m.text,
        image_urls=m.image_urls,
        params=m.params,
        status=m.status,
        created_at=m.created_at,
    )


async def _load_owned_conv(db: AsyncSession, user_id: int, conv_id: int) -> Conversation:
    """加载属于 user 的、未软删的会话；找不到抛 404"""
    res = await db.execute(
        select(Conversation).where(
            and_(
                Conversation.id == conv_id,
                Conversation.user_id == user_id,
                Conversation.deleted_at.is_(None),
            )
        )
    )
    conv = res.scalar_one_or_none()
    if conv is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "conversation_not_found", "message": "会话不存在或已删除"}},
        )
    return conv


async def _create_pending_ai_msg(
    db: AsyncSession, conv_id: int, init_params: dict[str, Any]
) -> Message:
    """在请求 session 里写入一条 pending ai message，返回带 id 的实体"""
    now = datetime.utcnow()
    msg = Message(
        conversation_id=conv_id,
        role="ai",
        text="生成中…",
        image_urls=None,
        params=init_params,
        status="pending",
        created_at=now,
    )
    db.add(msg)
    await db.flush()  # 拿 id
    return msg


async def _finalize_message(
    factory, ai_msg_id: int, conv_id: int, *, ok: bool, text: str,
    image_urls: list[str] | None = None, params: dict[str, Any] | None = None,
) -> None:
    """后台 task 调上游结束后，用独立 session 把消息状态固化下来 + bump conv.updated_at"""
    async with factory() as db:
        try:
            values: dict[str, Any] = {
                "status": "done" if ok else "failed",
                "text": text,
            }
            if image_urls is not None:
                values["image_urls"] = image_urls
            if params is not None:
                values["params"] = params
            await db.execute(update(Message).where(Message.id == ai_msg_id).values(**values))
            await db.execute(
                update(Conversation)
                .where(Conversation.id == conv_id)
                .values(updated_at=datetime.utcnow())
            )
            await db.commit()
        except Exception:  # noqa: BLE001
            await db.rollback()
            logger.exception("finalize_message 写库失败 ai_msg_id=%s", ai_msg_id)


def _parse_upstream_images(
    upstream_json: dict[str, Any], output_format: str = "png"
) -> tuple[list[str], dict[str, Any], int]:
    """从上游响应解出 url 列表 / usage / 图片数"""
    data_list = upstream_json.get("data", []) or []
    urls: list[str] = []
    for item in data_list:
        url = item.get("url")
        if url:
            urls.append(url)
            continue
        b64 = item.get("b64_json")
        if b64:
            urls.append(f"data:image/{output_format};base64,{b64}")
    usage_raw = upstream_json.get("usage") or {}
    usage = {
        "input_tokens": int(usage_raw.get("input_tokens", 0)),
        "output_tokens": int(usage_raw.get("output_tokens", 0)),
        "total_tokens": int(usage_raw.get("total_tokens", 0)),
    }
    return urls, usage, len(data_list)


_DATA_IMAGE_RE = re.compile(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.*)$", re.DOTALL)
_IMAGE_EXT_BY_CT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def _image_ext(content_type: str, output_format: str) -> str:
    ct = content_type.split(";", 1)[0].strip().lower()
    if ct in _IMAGE_EXT_BY_CT:
        return _IMAGE_EXT_BY_CT[ct]
    fallback = (output_format or "png").strip().lower().lstrip(".")
    if fallback == "jpeg":
        fallback = "jpg"
    if not re.fullmatch(r"[a-z0-9]+", fallback):
        fallback = "png"
    return f".{fallback}"


async def _write_generated_image(
    root: Path,
    *,
    ai_msg_id: int,
    index: int,
    content_type: str,
    output_format: str,
    body: bytes,
) -> str:
    max_bytes = 50 * 1024 * 1024
    if len(body) > max_bytes:
        raise ValueError("生成图片超过 50 MB")
    root.mkdir(parents=True, exist_ok=True)
    ext = _image_ext(content_type, output_format)
    filename = f"{ai_msg_id}-{index}-{secrets.token_hex(8)}{ext}"
    path = (root / filename).resolve()
    if root not in path.parents:
        raise ValueError("生成图片路径越界")
    await asyncio.to_thread(path.write_bytes, body)
    return f"/api/images/local/{filename}"


async def _download_generated_image(src: str, output_format: str) -> tuple[bytes, str]:
    settings = get_settings()
    timeout = httpx.Timeout(
        settings.generated_image_cache_timeout,
        connect=min(5.0, settings.generated_image_cache_timeout),
    )
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        resp = await client.get(src)
        resp.raise_for_status()
        ct = resp.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if not ct.startswith("image/"):
            raise ValueError(f"非图片 Content-Type：{ct}")
        body = resp.content
    return body, ct or f"image/{output_format or 'png'}"


async def _persist_generated_images(
    urls: list[str],
    *,
    output_format: str,
    ai_msg_id: int,
) -> list[str]:
    """把上游返回的短期图源保存到本地，保存失败时保留原 URL。"""
    settings = get_settings()
    root = Path(settings.generated_image_dir).resolve()

    async def persist_one(idx: int, src: str) -> str:
        try:
            if src.startswith("data:"):
                match = _DATA_IMAGE_RE.match(src)
                if not match:
                    raise ValueError("无法识别 data:image")
                content_type, b64 = match.groups()
                try:
                    body = base64.b64decode(b64, validate=True)
                except binascii.Error as e:
                    raise ValueError("data:image base64 无效") from e
            else:
                parsed = urlparse(src)
                if parsed.scheme not in ("http", "https"):
                    return src
                body, content_type = await _download_generated_image(src, output_format)

            return await _write_generated_image(
                root,
                ai_msg_id=ai_msg_id,
                index=idx,
                content_type=content_type,
                output_format=output_format,
                body=body,
            )
        except Exception:  # noqa: BLE001
            logger.warning("生成图片本地缓存失败 ai_msg_id=%s idx=%s", ai_msg_id, idx, exc_info=True)
            return src

    return list(await asyncio.gather(*(persist_one(idx, src) for idx, src in enumerate(urls))))


async def _persist_generated_assets_for_message(
    factory,
    urls: list[str],
    *,
    output_format: str,
    ai_msg_id: int,
    conv_id: int,
    user_id: int,
) -> list[str]:
    """写入生成图片资产索引，失败时回退旧本地缓存路径，避免阻断出图。"""
    try:
        async with factory() as asset_db:
            public_urls = await persist_generated_assets(
                asset_db,
                user_id=user_id,
                conversation_id=conv_id,
                message_id=ai_msg_id,
                urls=urls,
                output_format=output_format,
            )
            await asset_db.commit()
            return public_urls
    except Exception:  # noqa: BLE001
        logger.warning("生成图片资产索引写入失败 ai_msg_id=%s，回退本地缓存", ai_msg_id, exc_info=True)
        return await _persist_generated_images(
            urls,
            output_format=output_format,
            ai_msg_id=ai_msg_id,
        )


async def _update_upstream_stats(
    factory,
    *,
    success: bool,
) -> None:
    """后台任务完成后，更新上游渠道的请求/失败计数。

    按 base_url 匹配当前使用的上游渠道；如果数据库中没有对应记录，
    自动从环境变量创建一条默认渠道，确保监控面板始终有数据。
    """
    from ..models import UpstreamChannel

    settings = get_settings()
    base_url = settings.openai_base_url

    async with factory() as db:
        try:
            # 按 base_url 精确匹配
            ch = (await db.execute(
                select(UpstreamChannel)
                .where(UpstreamChannel.base_url == base_url)
                .limit(1)
            )).scalar_one_or_none()

            # 找不到则自动创建默认渠道（从环境变量）
            if ch is None:
                ch = UpstreamChannel(
                    name="默认上游",
                    base_url=base_url,
                    api_key=settings.openai_api_key,
                    enabled=True,
                    priority=100,
                    supports_edit=True,
                    max_concurrent=10,
                    timeout_seconds=int(settings.openai_timeout),
                )
                db.add(ch)
                await db.flush()

            ch.total_requests = (ch.total_requests or 0) + 1
            if not success:
                ch.total_failures = (ch.total_failures or 0) + 1
            await db.commit()
        except Exception:
            await db.rollback()
            logger.exception("更新上游渠道统计失败")


# ===== /generate =====


async def _run_generate_task(
    ai_msg_id: int,
    conv_id: int,
    payload: dict[str, Any],
    action_label: str,
    user_id: int,
    cost: int,
) -> None:
    """后台任务：调上游 generate，回写 message。失败时退款。"""
    factory = get_session_factory()
    try:
        upstream_json = await call_images_generate(payload)
    except UpstreamTimeout as e:
        await _finalize_message(
            factory, ai_msg_id, conv_id, ok=False, text=f"失败：上游超时 ({e})"
        )
        await _refund_credits(factory, user_id, ai_msg_id, cost, f"上游超时 ({e})")
        await _update_upstream_stats(factory, success=False)
        return
    except UpstreamError as e:
        await _finalize_message(
            factory, ai_msg_id, conv_id, ok=False,
            text=f"失败：upstream_error：{e}",
        )
        await _refund_credits(factory, user_id, ai_msg_id, cost, f"upstream_error: {e}")
        await _update_upstream_stats(factory, success=False)
        return
    except Exception as e:  # noqa: BLE001
        logger.exception("generate task 异常 ai_msg_id=%s", ai_msg_id)
        await _finalize_message(
            factory, ai_msg_id, conv_id, ok=False, text=f"失败：{e}"
        )
        await _refund_credits(factory, user_id, ai_msg_id, cost, f"task 异常: {e}")
        await _update_upstream_stats(factory, success=False)
        return

    output_format = str(payload.get("output_format") or "png")
    urls, usage, _n_imgs = _parse_upstream_images(
        upstream_json, output_format=output_format
    )
    returned = len(urls)
    requested = int(payload.get("n") or 1)

    # 上游返回 0 张图 = 业务失败：状态置 failed + 全额退款，不向用户展示假成功
    if returned == 0:
        await _finalize_message(
            factory, ai_msg_id, conv_id, ok=False,
            text=f"失败：上游未返回任何图片（usage {usage['total_tokens']} tokens）",
        )
        await _refund_credits(factory, user_id, ai_msg_id, cost, "上游 data=[] 未返回图片")
        await _update_upstream_stats(factory, success=False)
        return

    # 部分缺图：按缺失张数退款（每张 1 分，与 _calculate_cost 对齐）
    missing = max(0, requested - returned)
    if missing > 0:
        await _refund_credits(
            factory, user_id, ai_msg_id, missing,
            f"上游仅返回 {returned}/{requested} 张",
        )

    text = f"{action_label} {returned} 张 · {usage['total_tokens']} tokens"
    if missing > 0:
        text += f"（请求 {requested} 张，已退 {missing} 积分）"
    urls = await _persist_generated_assets_for_message(
        factory,
        urls,
        output_format=output_format,
        ai_msg_id=ai_msg_id,
        conv_id=conv_id,
        user_id=user_id,
    )

    params = {
        "model": upstream_json.get("model", payload.get("model")),
        "usage": usage,
        # 把请求参数也存一份方便 UI 还原
        "request": {k: v for k, v in payload.items() if k != "prompt"},
    }
    await _finalize_message(
        factory, ai_msg_id, conv_id, ok=True, text=text,
        image_urls=urls, params=params,
    )
    await _update_upstream_stats(factory, success=True)


@router.post("/generate", response_model=MessageOut)
@limiter.limit(lambda: get_settings().rate_limit_generate, key_func=user_id_key)
async def generate(
    request: Request,  # slowapi 装饰器要求第一个参数能拿到 Request
    req: GenerateRequest,
    conversation_id: int = Query(..., description="目标会话 id；ai message 写入此会话"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    """文本生图（任务化）：
    立即落库一条 pending ai message，启动后台 task 调上游，前端拿 message 后开始轮询。
    """
    # 未验证邮箱用户不允许触发上游 API key 消耗
    require_verified_user(user)
    upstream_model = "gpt-image-2"
    payload: dict[str, Any] = {
        "model": upstream_model,
        "prompt": req.prompt,
        "size": req.size,
        "quality": req.quality,
        "n": req.n,
        "background": req.background,
        "output_format": req.output_format,
        "moderation": req.moderation,
    }
    if req.reasoning:
        payload["reasoning"] = True
    if req.output_format in {"jpeg", "webp"} and req.output_compression is not None:
        payload["output_compression"] = req.output_compression

    # 鉴权 + 会话归属校验
    conv = await _load_owned_conv(db, user.id, conversation_id)

    # 预扣积分（与 pending msg 同事务）
    cost = _calculate_cost(req.n)
    current_credits = user.credits or 0
    if current_credits < cost:
        raise _insufficient_credits(current=current_credits, need=cost)

    init_params = {
        "request": {k: v for k, v in payload.items() if k != "prompt"},
        "cost": cost,
    }
    msg = await _create_pending_ai_msg(db, conv.id, init_params)
    await db.flush()  # 拿 msg.id 给 CreditTransaction.ref_id 引用
    await _charge_credits(db, user, cost, msg.id, reason="generate", request=request)
    await db.commit()
    await db.refresh(msg)

    # 启动后台任务（与请求生命周期解耦；持有强引用避免被 GC）
    _spawn_background_task(
        _run_generate_task(
            msg.id, conv.id, payload,
            action_label="已生成",
            user_id=user.id, cost=cost,
        )
    )

    return JSONResponse(content=_to_msg_out(msg).model_dump(mode="json"))


# ===== /edit =====


async def _run_edit_task(
    ai_msg_id: int,
    conv_id: int,
    fields: dict[str, Any],
    files: list[tuple[str, tuple[str, bytes, str]]],
    user_id: int,
    cost: int,
    dropped_refs: int = 0,
    force_backup: bool = False,
) -> None:
    """后台任务：调上游 edit，回写 message。失败时退款。"""
    factory = get_session_factory()
    try:
        upstream_json = await call_images_edit(fields, files, force_backup=force_backup)
    except UpstreamTimeout as e:
        await _finalize_message(
            factory, ai_msg_id, conv_id, ok=False, text=f"失败：上游超时 ({e})"
        )
        await _refund_credits(factory, user_id, ai_msg_id, cost, f"上游超时 ({e})")
        await _update_upstream_stats(factory, success=False)
        return
    except UpstreamError as e:
        await _finalize_message(
            factory, ai_msg_id, conv_id, ok=False,
            text=f"失败：upstream_error：{e}",
        )
        await _refund_credits(factory, user_id, ai_msg_id, cost, f"upstream_error: {e}")
        await _update_upstream_stats(factory, success=False)
        return
    except Exception as e:  # noqa: BLE001
        logger.exception("edit task 异常 ai_msg_id=%s", ai_msg_id)
        await _finalize_message(
            factory, ai_msg_id, conv_id, ok=False, text=f"失败：{e}"
        )
        await _refund_credits(factory, user_id, ai_msg_id, cost, f"task 异常: {e}")
        await _update_upstream_stats(factory, success=False)
        return

    output_format = str(fields.get("output_format") or "png")
    urls, usage, _n_imgs = _parse_upstream_images(
        upstream_json, output_format=output_format
    )
    returned = len(urls)
    requested = int(fields.get("n") or 1)

    # 上游返回 0 张图 = 业务失败：状态置 failed + 全额退款
    if returned == 0:
        await _finalize_message(
            factory, ai_msg_id, conv_id, ok=False,
            text=f"失败：上游未返回任何图片（usage {usage['total_tokens']} tokens）",
        )
        await _refund_credits(factory, user_id, ai_msg_id, cost, "上游 data=[] 未返回图片")
        await _update_upstream_stats(factory, success=False)
        return

    # 部分缺图：按缺失张数退款（每张 1 分）
    missing = max(0, requested - returned)
    if missing > 0:
        await _refund_credits(
            factory, user_id, ai_msg_id, missing,
            f"上游仅返回 {returned}/{requested} 张",
        )

    text = f"已修改 {returned} 张 · {usage['total_tokens']} tokens"
    if missing > 0:
        text += f"（请求 {requested} 张，已退 {missing} 积分）"
    if dropped_refs > 0:
        text += f"（已忽略 {dropped_refs} 张副参考图，当前上游仅支持单图）"
    if force_backup:
        text += "（多图模式，已自动切换备用上游）"
    urls = await _persist_generated_assets_for_message(
        factory,
        urls,
        output_format=output_format,
        ai_msg_id=ai_msg_id,
        conv_id=conv_id,
        user_id=user_id,
    )

    params = {
        "mode": "edit",
        "model": upstream_json.get("model", fields.get("model")),
        "usage": usage,
        "request": {k: v for k, v in fields.items() if k != "prompt"},
    }
    await _finalize_message(
        factory, ai_msg_id, conv_id, ok=True, text=text,
        image_urls=urls, params=params,
    )
    await _update_upstream_stats(factory, success=True)


@router.post("/edit", response_model=MessageOut)
@limiter.limit(lambda: get_settings().rate_limit_generate, key_func=user_id_key)
async def edit(
    request: Request,
    image: list[UploadFile] = File(..., description="参考图（1~N 张）；mask 仅对齐第 1 张"),
    mask: UploadFile = File(..., description="mask PNG"),
    prompt: str = Form(..., min_length=1),
    conversation_id: int = Form(..., description="目标会话 id"),
    model: str = Form("gpt-image-2"),
    size: str = Form("auto"),
    quality: str = Form("low"),
    n: int = Form(1),
    background: str = Form("auto"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    """Inpainting / 多参考图编辑（任务化）：行为同 /generate"""
    # verified 闸放最前，避免未验证用户上传 multipart 字节
    require_verified_user(user)
    api_size = size.replace("×", "x")
    upstream_model = "gpt-image-2"

    if not image:
        raise HTTPException(
            status_code=400,
            detail={"error": {"code": "validation_error", "message": "至少需要 1 张参考图"}},
        )

    # 同步读完 multipart 字节（task 内不能再访问 stream）
    settings = get_settings()
    max_bytes = settings.upload_max_bytes
    image_payloads: list[tuple[str, bytes, str]] = []
    for idx, up in enumerate(image):
        b = await up.read()
        if not b:
            raise HTTPException(
                status_code=400,
                detail={"error": {"code": "validation_error", "message": f"image[{idx}] 为空"}},
            )
        if len(b) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail={
                    "error": {
                        "code": "file_too_large",
                        "message": f"image[{idx}] 超出 {max_bytes // (1024*1024)} MB 上限",
                    }
                },
            )
        image_payloads.append(
            (up.filename or f"image-{idx}.png", b, up.content_type or "image/png")
        )
    mask_bytes = await mask.read()
    if not mask_bytes:
        raise HTTPException(
            status_code=400,
            detail={"error": {"code": "validation_error", "message": "mask 为空"}},
        )
    if len(mask_bytes) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail={
                "error": {
                    "code": "file_too_large",
                    "message": f"mask 超出 {max_bytes // (1024*1024)} MB 上限",
                }
            },
        )

    # 鉴权 + 会话归属校验
    conv = await _load_owned_conv(db, user.id, conversation_id)

    # 预扣积分（与 pending msg 同事务）
    cost = _calculate_cost(n)
    current_credits = user.credits or 0
    if current_credits < cost:
        raise _insufficient_credits(current=current_credits, need=cost)

    fields: dict[str, Any] = {
        "model": upstream_model,
        "prompt": prompt,
        "size": api_size,
        "quality": quality,
        "n": str(n),
        "background": background,
    }
    # 多图 → 自动切到飞鱼（feiyuai 支持多图）；单图 → 走 tabcode 主上游
    multi = len(image_payloads) > 1
    if multi:
        files: list[tuple[str, tuple[str, bytes, str]]] = [
            ("image", p) for p in image_payloads
        ]
        files.append(("mask", ("mask.png", mask_bytes, "image/png")))
        dropped_refs = 0
    else:
        dropped_refs = 0
        main_payload = image_payloads[0]
        files = [("image", main_payload)]
        files.append(("mask", ("mask.png", mask_bytes, "image/png")))

    init_params = {
        "mode": "edit",
        "request": {k: v for k, v in fields.items() if k != "prompt"},
        "cost": cost,
    }
    msg = await _create_pending_ai_msg(db, conv.id, init_params)
    await db.flush()  # 拿 msg.id
    await _charge_credits(db, user, cost, msg.id, reason="edit", request=request)
    await db.commit()
    await db.refresh(msg)

    _spawn_background_task(
        _run_edit_task(
            msg.id, conv.id, fields, files, user_id=user.id, cost=cost,
            dropped_refs=dropped_refs,
            force_backup=multi,
        )
    )
    _ = model  # 显式吸收 unused 参数避免 lint

    return JSONResponse(content=_to_msg_out(msg).model_dump(mode="json"))


# ===== proxy-image / segment / brush-cutout =====


@router.get("/local/{filename}")
async def local_generated_image(filename: str) -> Response:
    """读取已本地化的生成图片。"""
    if "/" in filename or "\\" in filename or filename in {"", ".", ".."}:
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "validation_error", "message": "图片文件名无效"}},
        )

    root = Path(get_settings().generated_image_dir).resolve()
    path = (root / filename).resolve()
    try:
        path.relative_to(root)
    except ValueError:
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "validation_error", "message": "图片路径无效"}},
        )

    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    if not path.is_file() or not media_type.startswith("image/"):
        return JSONResponse(
            status_code=404,
            content={"error": {"code": "image_not_found", "message": "图片不存在"}},
        )

    return FileResponse(
        path,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@router.get("/proxy-image")
async def proxy_image(
    request: Request,
    url: str = Query(..., description="上游图片 URL"),
) -> Response:
    """反代上游 CDN 图片，规避前端 canvas 跨域 taint。

    === 优化 (v2) ===
    - 流式返回：边下载边推给浏览器，消除首字节等待
    - Redis 缓存：第二次请求同一张图直接从缓存出
    - 无鉴权（要支持 <img src> 直接用）；host 白名单同 v1
    - 限流由全局 IP rate_limit_global 覆盖（120/分钟）
    """
    settings = get_settings()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "validation_error", "message": "仅支持 http/https URL"}},
        )

    # host 白名单检查
    host = (parsed.hostname or "").lower()
    if not host:
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "validation_error", "message": "URL 缺少 host"}},
        )

    allow = set(settings.proxy_image_host_allowlist)
    for base in (settings.openai_base_url, settings.openai_base_url_backup):
        if base:
            h = (urlparse(base).hostname or "").lower()
            if h:
                allow.add(h)
    if allow and host not in allow:
        return JSONResponse(
            status_code=403,
            content={
                "error": {
                    "code": "host_not_allowed",
                    "message": f"host '{host}' 不在反代白名单内",
                }
            },
        )

    # ① 尝试 Redis 缓存 → 命中则流式返回（64KB 分块）
    cached = await cache_image_get(url)
    if cached is not None:
        hdr_len = int.from_bytes(cached[:4], "little")
        meta = json.loads(cached[4 : 4 + hdr_len].decode("utf-8"))
        body = cached[4 + hdr_len:]
        return StreamingResponse(
            _chunk_iter(body),
            media_type=meta["ct"],
            headers={"Cache-Control": "public, max-age=3600"},
        )

    # ② 缓存 miss → 流式下载 + 后台缓存
    max_bytes = 50 * 1024 * 1024

    timeout = httpx.Timeout(settings.proxy_image_timeout, connect=min(3.0, settings.proxy_image_timeout))
    client = httpx.AsyncClient(timeout=timeout, follow_redirects=True)
    try:
        req = client.build_request("GET", url)
        up_resp = await client.send(req, stream=True)
    except httpx.TimeoutException as e:
        await client.aclose()
        return JSONResponse(
            status_code=504,
            content={"error": {"code": "upstream_timeout", "message": f"拉取图片超时：{e}"}},
        )
    except httpx.HTTPError as e:
        await client.aclose()
        return JSONResponse(
            status_code=502,
            content={"error": {"code": "upstream_error", "message": f"拉取图片失败：{e}"}},
        )

    if up_resp.status_code >= 400:
        await up_resp.aclose()
        await client.aclose()
        return JSONResponse(
            status_code=502,
            content={
                "error": {
                    "code": "upstream_error",
                    "message": f"上游图片返回 HTTP {up_resp.status_code}",
                    "upstream_status": up_resp.status_code,
                },
            },
        )

    ct = up_resp.headers.get("Content-Type", "")
    if not ct.startswith("image/"):
        await up_resp.aclose()
        await client.aclose()
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "validation_error", "message": f"非图片 Content-Type：{ct}"}},
        )

    content_length = up_resp.headers.get("Content-Length")
    if content_length and int(content_length) > max_bytes:
        await up_resp.aclose()
        await client.aclose()
        return JSONResponse(
            status_code=413,
            content={"error": {"code": "payload_too_large", "message": "图片超过 50 MB"}},
        )

    # 流式转发 + 内存缓冲（供后台写 Redis）
    async def _pipe():
        chunks: list[bytes] = []
        total = 0
        try:
            async for chunk in up_resp.aiter_bytes():
                total += len(chunk)
                if total > max_bytes:
                    raise HTTPException(status_code=413, detail="图片超过 50 MB")
                chunks.append(chunk)
                yield chunk
        except httpx.HTTPError:
            return  # 静默中断
        finally:
            await up_resp.aclose()
            await client.aclose()
            # 流结束后后台写 Redis
            if chunks:
                body = b"".join(chunks)
                meta_bytes = json.dumps({"ct": ct}).encode("utf-8")
                hdr_packed = len(meta_bytes).to_bytes(4, "little") + meta_bytes + body
                if len(hdr_packed) <= max_bytes:
                    asyncio.create_task(cache_image_set(url, hdr_packed))

    return StreamingResponse(
        _pipe(),
        media_type=ct,
        headers={"Cache-Control": "public, max-age=3600"},
    )


def _chunk_iter(data: bytes, size: int = 64 * 1024):
    """将 bytes 分块 yield，避免 StreamingResponse 一次发完大包"""
    for i in range(0, len(data), size):
        yield data[i : i + size]


@router.post("/segment")
@limiter.limit(lambda: get_settings().rate_limit_segment, key_func=user_id_key)
async def segment(
    request: Request,
    req: SegmentRequest,
    user: User = Depends(get_current_user),
) -> Response:
    """ML 抠图：在用户矩形周围 ROI 扩展，分割模型，紧凑 bbox 返回透明 PNG"""
    _ = user  # 仅鉴权用
    try:
        img_bytes, _ct = await fetch_image_bytes(req.url)
    except ValueError as e:
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "validation_error", "message": str(e)}},
        )
    except (httpx.TimeoutException, httpx.HTTPError) as e:
        return JSONResponse(
            status_code=502,
            content={"error": {"code": "upstream_error", "message": f"拉取图片失败：{e}"}},
        )

    try:
        png_bytes = await asyncio.to_thread(
            segment_sync, img_bytes, req.x, req.y, req.w, req.h, req.padding_factor,
        )
    except ValueError as e:
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "validation_error", "message": str(e)}},
        )
    except Exception as e:  # noqa: BLE001
        return JSONResponse(
            status_code=500,
            content={"error": {"code": "model_error", "message": f"抠图失败：{e}"}},
        )

    return Response(content=png_bytes, media_type="image/png")


@router.post("/brush-cutout")
@limiter.limit(lambda: get_settings().rate_limit_segment, key_func=user_id_key)
async def brush_cutout(
    request: Request,
    image: UploadFile = File(..., description="原图（PNG/JPEG）"),
    mask: UploadFile = File(..., description="笔刷蒙版 PNG"),
    subject_type: str = Form("auto"),
    user: User = Depends(get_current_user),
) -> Response:
    """笔刷 mask → 精细抠图（MobileSAM）"""
    _ = subject_type, user
    settings = get_settings()
    max_bytes = settings.upload_max_bytes
    image_bytes = await image.read()
    mask_bytes = await mask.read()
    if not image_bytes or not mask_bytes:
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "validation_error", "message": "image 或 mask 为空"}},
        )
    if len(image_bytes) > max_bytes or len(mask_bytes) > max_bytes:
        return JSONResponse(
            status_code=413,
            content={
                "error": {
                    "code": "file_too_large",
                    "message": f"上传超过 {max_bytes // (1024*1024)} MB 上限",
                }
            },
        )

    try:
        png_bytes = await asyncio.to_thread(
            segment_brush_mobile_sam, image_bytes, mask_bytes
        )
    except ValueError as e:
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "validation_error", "message": str(e)}},
        )
    except Exception as e:  # noqa: BLE001
        logger.exception("brush-cutout 失败")
        return JSONResponse(
            status_code=500,
            content={"error": {"code": "model_error", "message": f"抠图失败：{e}"}},
        )
    return Response(content=png_bytes, media_type="image/png")


# ===== 显式吸收未使用导入（为兼容旧 import 暴露空 alias） =====
_ErrorDetail = ErrorDetail  # noqa: F841
_ErrorResponse = ErrorResponse  # noqa: F841
