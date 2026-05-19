"""/api/conversations/* —— AI 对话历史 CRUD

设计要点见 docs/specs/2026-05-18-ai-conversation-history-design.md
"""
from __future__ import annotations

from datetime import datetime
from typing import Sequence

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse, Response
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..db import get_db
from ..deps import get_current_user
from ..models import Conversation, Message, User
from ..schemas import (
    ConversationDetailOut,
    ConversationListOut,
    ConversationPatchIn,
    MessageCreateIn,
    MessageOut,
)

router = APIRouter(prefix="/api/conversations", tags=["conversations"])

# ===== helpers =====


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"error": {"code": "conversation_not_found", "message": "会话不存在或已删除"}},
    )


def _bad_request(code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={"error": {"code": code, "message": message}},
    )


def _to_msg_out(m: Message) -> MessageOut:
    return MessageOut(
        id=m.id,
        role=m.role,
        text=m.text,
        image_urls=m.image_urls,
        params=m.params,
        status=getattr(m, "status", "done"),
        created_at=m.created_at,
    )


async def _load_owned_conv(
    db: AsyncSession, user_id: int, conv_id: int, with_messages: bool = False
) -> Conversation:
    """加载属于 user 的、未软删的会话；找不到抛 404"""
    stmt = select(Conversation).where(
        and_(
            Conversation.id == conv_id,
            Conversation.user_id == user_id,
            Conversation.deleted_at.is_(None),
        )
    )
    if with_messages:
        stmt = stmt.options(selectinload(Conversation.messages))
    res = await db.execute(stmt)
    conv = res.scalar_one_or_none()
    if conv is None:
        raise _not_found()
    return conv


async def _build_list_out(db: AsyncSession, conv: Conversation) -> ConversationListOut:
    """为列表卡片构造 ConversationListOut（含 preview + message_count）"""
    # 取首条 user message 作为 preview（找不到就空串）
    first_user = await db.execute(
        select(Message.text)
        .where(and_(Message.conversation_id == conv.id, Message.role == "user"))
        .order_by(Message.id.asc())
        .limit(1)
    )
    first_text = first_user.scalar_one_or_none() or ""
    preview = first_text.strip().replace("\n", " ")[:60]

    cnt_res = await db.execute(
        select(func.count(Message.id)).where(Message.conversation_id == conv.id)
    )
    cnt = int(cnt_res.scalar_one() or 0)
    pending_res = await db.execute(
        select(func.count(Message.id)).where(
            and_(
                Message.conversation_id == conv.id,
                Message.role == "ai",
                Message.status == "pending",
            )
        )
    )
    has_pending = int(pending_res.scalar_one() or 0) > 0

    return ConversationListOut(
        id=conv.id,
        title=conv.title,
        pinned=conv.pinned,
        preview=preview,
        message_count=cnt,
        has_pending=has_pending,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
    )


def _make_title_from_text(text: str, limit: int = 30) -> str:
    """首条 user message 的标题派生：去换行、trim、截断"""
    one_line = text.strip().replace("\n", " ").replace("\r", " ")
    return one_line[:limit]


# ===== endpoints =====


@router.get("", response_model=list[ConversationListOut])
async def list_conversations(
    q: str | None = Query(default=None, max_length=120),
    pinned: int | None = Query(default=None, ge=0, le=1),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """会话列表：按 (pinned DESC, updated_at DESC) 排序

    - q：关键词，ILIKE %q% 匹配 title 或 首条 user message.text
    - pinned：1 仅置顶；0 仅非置顶；省略则不过滤
    """
    base = select(Conversation).where(
        and_(Conversation.user_id == user.id, Conversation.deleted_at.is_(None))
    )

    if pinned is not None:
        base = base.where(Conversation.pinned == bool(pinned))

    if q:
        kw = f"%{q.strip()}%"
        # 命中 title 的会话 id
        title_hit = select(Conversation.id).where(
            and_(
                Conversation.user_id == user.id,
                Conversation.deleted_at.is_(None),
                Conversation.title.ilike(kw),
            )
        )
        # 命中首条 user message 的会话 id（任意一条 user message 命中即可，避免再绕一层"首条"过滤）
        msg_hit = select(Message.conversation_id).where(
            and_(Message.role == "user", Message.text.ilike(kw))
        )
        base = base.where(or_(Conversation.id.in_(title_hit), Conversation.id.in_(msg_hit)))

    stmt = base.order_by(Conversation.pinned.desc(), Conversation.updated_at.desc()).limit(200)
    res = await db.execute(stmt)
    convs: Sequence[Conversation] = res.scalars().all()

    # 串行构造每条 preview/count；MVP 列表 ≤200，串行即可
    out: list[ConversationListOut] = []
    for c in convs:
        out.append(await _build_list_out(db, c))
    return out


@router.post("", response_model=ConversationDetailOut, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """新建空会话；title 留空，首条 user message 写入时自动回填"""
    now = datetime.utcnow()
    conv = Conversation(
        user_id=user.id,
        title="",
        pinned=False,
        created_at=now,
        updated_at=now,
    )
    db.add(conv)
    await db.commit()
    await db.refresh(conv)

    return ConversationDetailOut(
        id=conv.id,
        title=conv.title,
        pinned=conv.pinned,
        preview="",
        message_count=0,
        has_pending=False,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
        messages=[],
    )


@router.get("/{conv_id}", response_model=ConversationDetailOut)
async def get_conversation(
    conv_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """会话详情 + 完整 messages"""
    conv = await _load_owned_conv(db, user.id, conv_id, with_messages=True)
    list_out = await _build_list_out(db, conv)
    return ConversationDetailOut(
        **list_out.model_dump(),
        messages=[_to_msg_out(m) for m in conv.messages],
    )


@router.patch("/{conv_id}", response_model=ConversationListOut)
async def patch_conversation(
    conv_id: int,
    payload: ConversationPatchIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """重命名 / 置顶"""
    if payload.title is None and payload.pinned is None:
        raise _bad_request("invalid_request", "title / pinned 至少要一个")

    conv = await _load_owned_conv(db, user.id, conv_id)
    if payload.title is not None:
        conv.title = payload.title
    if payload.pinned is not None:
        conv.pinned = payload.pinned
    await db.commit()
    await db.refresh(conv)
    return await _build_list_out(db, conv)


@router.delete("/{conv_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    conv_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """软删除（写 deleted_at），列表/详情都会跳过此条"""
    conv = await _load_owned_conv(db, user.id, conv_id)
    conv.deleted_at = datetime.utcnow()
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{conv_id}/messages", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
async def post_message(
    conv_id: int,
    payload: MessageCreateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """追加一条 message

    副作用：
    - 更新 conversation.updated_at（让 timeline 排序刷到最前）
    - 若 conversation.title 为空且 payload.role == "user"，自动取 text 前 30 字作为 title
    """
    conv = await _load_owned_conv(db, user.id, conv_id)

    msg = Message(
        conversation_id=conv.id,
        role=payload.role,
        text=payload.text,
        image_urls=payload.image_urls,
        params=payload.params,
        created_at=datetime.utcnow(),
    )
    db.add(msg)

    conv.updated_at = msg.created_at
    if not conv.title and payload.role == "user":
        conv.title = _make_title_from_text(payload.text)

    await db.commit()
    await db.refresh(msg)

    return _to_msg_out(msg)
