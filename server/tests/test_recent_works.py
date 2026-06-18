"""recent_works 路由集成测试

环境与依赖（与 test_auth_routes_int.py 相同）：
- DATABASE_URL / REDIS_URL / JWT_SECRET 必须配置
- Redis 用 DB 15 隔离
- 集成测试自带 teardown 清理痕迹

跑：
  cd D:/webProject/image2/server
  python -m unittest tests.test_recent_works
"""
from __future__ import annotations

import asyncio
import os
import unittest
import uuid
from datetime import datetime, timedelta
from urllib.parse import urlparse, urlunparse

from dotenv import load_dotenv

load_dotenv()

os.environ["EMAIL_PROVIDER"] = "null"
os.environ["RATE_LIMIT_REGISTER"] = "1000/minute"
os.environ["RATE_LIMIT_VERIFY_EMAIL"] = "1000/minute"
os.environ["RATE_LIMIT_RESEND_VERIFICATION"] = "1000/minute"

_redis_test_url = os.getenv("REDIS_URL_TEST")
if not _redis_test_url:
    _orig = os.getenv("REDIS_URL", "")
    if _orig:
        parsed = urlparse(_orig)
        new_path = "/15"
        os.environ["REDIS_URL"] = urlunparse(parsed._replace(path=new_path))
else:
    os.environ["REDIS_URL"] = _redis_test_url

_DB_OK = bool(os.getenv("DATABASE_URL"))
_REDIS_OK = bool(os.getenv("REDIS_URL"))
_JWT_OK = bool(os.getenv("JWT_SECRET"))

if _DB_OK and _REDIS_OK and _JWT_OK:
    import httpx  # noqa: E402
    from sqlalchemy import delete  # noqa: E402

    from app.db import get_engine, get_session_factory  # noqa: E402
    from app.main import app  # noqa: E402
    from app.models import (  # noqa: E402
        AuditLog,
        Conversation,
        CreditTransaction,
        EmailVerificationToken,
        Message,
        GeneratedAsset,
        User,
    )
    from app.redis_client import get_redis  # noqa: E402


def _rand_email() -> str:
    return f"test-{uuid.uuid4().hex[:12]}@example.com"


@unittest.skipUnless(
    _DB_OK and _REDIS_OK and _JWT_OK,
    "DATABASE_URL / REDIS_URL / JWT_SECRET 未配置，跳过集成测试",
)
class RecentWorksTests(unittest.IsolatedAsyncioTestCase):
    created_emails: list[str]
    created_conv_ids: list[int]

    async def asyncSetUp(self) -> None:
        self.created_emails = []
        self.created_conv_ids = []

        # 每个用例新事件循环，得清掉 lru_cache 的旧连接
        get_engine.cache_clear()
        get_session_factory.cache_clear()
        get_redis.cache_clear()

        redis = get_redis()
        await redis.flushdb()

        transport = httpx.ASGITransport(app=app)
        self.client = httpx.AsyncClient(transport=transport, base_url="http://test")
        await self.client.__aenter__()

    async def asyncTearDown(self) -> None:
        factory = get_session_factory()
        async with factory() as s:
            # 先删 conversations（messages 是级联），再删 user
            if self.created_conv_ids:
                await s.execute(
                    delete(Conversation).where(Conversation.id.in_(self.created_conv_ids))
                )
            if self.created_emails:
                rows = await s.execute(
                    User.__table__.select().where(User.email.in_(self.created_emails))
                )
                ids = [r.id for r in rows.fetchall()]
                if ids:
                    await s.execute(
                        delete(EmailVerificationToken).where(EmailVerificationToken.user_id.in_(ids))
                    )
                    await s.execute(
                        delete(CreditTransaction).where(CreditTransaction.user_id.in_(ids))
                    )
                    await s.execute(delete(AuditLog).where(AuditLog.user_id.in_(ids)))
                    await s.execute(delete(User).where(User.id.in_(ids)))
                await s.execute(delete(AuditLog).where(AuditLog.email.in_(self.created_emails)))
            await s.commit()
        await self.client.__aexit__(None, None, None)
        await get_engine().dispose()
        await get_redis().aclose()

    # ===== helpers =====

    async def _register_and_login(self) -> tuple[int, str]:
        """注册一个新用户并返回 (user_id, access_token)"""
        email = _rand_email()
        self.created_emails.append(email.lower())
        r = await self.client.post(
            "/api/auth/register",
            json={"email": email, "password": "Hunter2_pw"},
        )
        self.assertEqual(r.status_code, 201, r.text)
        body = r.json()
        return body["user"]["id"], body["access_token"]

    async def _create_conv(self, user_id: int, deleted: bool = False) -> int:
        """直接走 DB 建一个 conversation（不通过 /api，因为出图消息不能由前端 POST）"""
        factory = get_session_factory()
        async with factory() as s:
            conv = Conversation(user_id=user_id, title="test")
            if deleted:
                conv.deleted_at = datetime.utcnow()
            s.add(conv)
            await s.flush()
            cid = conv.id
            await s.commit()
        self.created_conv_ids.append(cid)
        return cid

    async def _add_msg(
        self,
        conv_id: int,
        *,
        role: str = "ai",
        status: str = "done",
        image_urls: list[str] | None = None,
        params: dict | None = None,
        created_at: datetime | None = None,
    ) -> int:
        """直接走 DB 落一条 message"""
        factory = get_session_factory()
        async with factory() as s:
            m = Message(
                conversation_id=conv_id,
                role=role,
                text="",
                image_urls=image_urls,
                params=params,
                status=status,
            )
            if created_at:
                m.created_at = created_at
            s.add(m)
            await s.flush()
            mid = m.id
            await s.commit()
        return mid

    async def _add_asset(
        self,
        *,
        user_id: int,
        conv_id: int,
        message_id: int,
        public_url: str,
        created_at: datetime | None = None,
    ) -> int:
        """直接给一条 AI 消息补资产索引，模拟历史图片迁移/缓存落库。"""
        factory = get_session_factory()
        async with factory() as s:
            asset = GeneratedAsset(
                user_id=user_id,
                conversation_id=conv_id,
                message_id=message_id,
                slot_index=0,
                storage_kind="local",
                storage_key=public_url.rsplit("/", 1)[-1],
                public_url=public_url,
                source_url="https://legacy.example/old.png",
                mime_type="image/png",
                status="available",
            )
            if created_at:
                asset.created_at = created_at
            s.add(asset)
            await s.flush()
            asset_id = asset.id
            await s.commit()
        return asset_id

    def _auth(self, token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    # ===== 用例 =====

    async def test_unauthorized_returns_401(self):
        r = await self.client.get("/api/me/recent-works")
        self.assertEqual(r.status_code, 401)

    async def test_empty_returns_empty_items(self):
        _uid, token = await self._register_and_login()
        r = await self.client.get("/api/me/recent-works", headers=self._auth(token))
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json(), {"items": []})

    async def test_only_ai_done_with_images_listed(self):
        """混入 user / pending / failed / image_urls 为 null 的 ai 消息 —— 仅 ai+done+非空图返回"""
        uid, token = await self._register_and_login()
        cid = await self._create_conv(uid)
        # 不该出现的：
        await self._add_msg(cid, role="user", image_urls=["should-not-appear-user.png"])
        await self._add_msg(cid, role="ai", status="pending", image_urls=["should-not-appear-pending.png"])
        await self._add_msg(cid, role="ai", status="failed", image_urls=["should-not-appear-failed.png"])
        await self._add_msg(cid, role="ai", status="done", image_urls=None)
        # 该出现的：
        good_id = await self._add_msg(cid, role="ai", status="done", image_urls=["good.png"])

        r = await self.client.get("/api/me/recent-works", headers=self._auth(token))
        self.assertEqual(r.status_code, 200, r.text)
        items = r.json()["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["message_id"], good_id)
        self.assertEqual(items[0]["image_url"], "good.png")

    async def test_skips_known_broken_history_image_host(self):
        """旧图源已确认不可达时，最近作品不再返回必然加载失败的缩略图。"""
        uid, token = await self._register_and_login()
        cid = await self._create_conv(uid)
        await self._add_msg(
            cid,
            role="ai",
            status="done",
            image_urls=["http://67.21.86.146:3015/images/dead.png"],
        )
        good_id = await self._add_msg(
            cid,
            role="ai",
            status="done",
            image_urls=["/api/images/assets/live.png"],
        )

        r = await self.client.get("/api/me/recent-works", headers=self._auth(token))
        self.assertEqual(r.status_code, 200, r.text)
        items = r.json()["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["message_id"], good_id)
        self.assertEqual(items[0]["image_url"], "/api/images/assets/live.png")

    async def test_asset_path_uses_message_created_at_not_asset_backfill_time(self):
        """本地资产是后来回填的，也必须显示原 AI 消息生成时间。"""
        uid, token = await self._register_and_login()
        cid = await self._create_conv(uid)
        message_time = datetime(2026, 5, 23, 10, 57, 48)
        asset_backfill_time = datetime(2026, 6, 19, 1, 50, 49)
        mid = await self._add_msg(
            cid,
            role="ai",
            status="done",
            image_urls=["https://legacy.example/old.png"],
            created_at=message_time,
        )
        await self._add_asset(
            user_id=uid,
            conv_id=cid,
            message_id=mid,
            public_url=f"/api/images/assets/{mid}-0.png",
            created_at=asset_backfill_time,
        )

        r = await self.client.get("/api/me/recent-works", headers=self._auth(token))
        self.assertEqual(r.status_code, 200, r.text)
        item = r.json()["items"][0]
        self.assertEqual(item["message_id"], mid)
        self.assertEqual(item["image_url"], f"/api/images/assets/{mid}-0.png")
        self.assertTrue(item["created_at"].startswith("2026-05-23T10:57:48"))

    async def test_scans_past_broken_latest_history_images(self):
        """最新一批历史坏图被过滤后，继续向后找仍可展示的作品。"""
        uid, token = await self._register_and_login()
        cid = await self._create_conv(uid)
        good_id = await self._add_msg(
            cid,
            role="ai",
            status="done",
            image_urls=["/api/images/assets/older-live.png"],
        )
        for i in range(15):
            await self._add_msg(
                cid,
                role="ai",
                status="done",
                image_urls=[f"http://67.21.86.146:3015/images/dead-{i}.png"],
            )

        r = await self.client.get("/api/me/recent-works", headers=self._auth(token))
        self.assertEqual(r.status_code, 200, r.text)
        items = r.json()["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["message_id"], good_id)
        self.assertEqual(items[0]["image_url"], "/api/images/assets/older-live.png")

    async def test_conversation_detail_replaces_known_broken_images_with_message(self):
        """会话详情不把坏 URL 交给前端反复尝试加载。"""
        uid, token = await self._register_and_login()
        cid = await self._create_conv(uid)
        mid = await self._add_msg(
            cid,
            role="ai",
            status="done",
            image_urls=["http://67.21.86.146:3015/images/dead.png"],
        )

        r = await self.client.get(f"/api/conversations/{cid}", headers=self._auth(token))
        self.assertEqual(r.status_code, 200, r.text)
        messages = r.json()["messages"]
        msg = next(m for m in messages if m["id"] == mid)
        self.assertIsNone(msg["image_urls"])
        self.assertEqual(msg["text"], "历史图源已失效，无法预览。")

    async def test_ordered_desc(self):
        """5 条按自然顺序生成 → 返回时是 id 倒序（最新优先）"""
        uid, token = await self._register_and_login()
        cid = await self._create_conv(uid)
        ids = []
        for i in range(5):
            mid = await self._add_msg(cid, image_urls=[f"img-{i}.png"])
            ids.append(mid)
        # ids[0] 是最旧（i=0 最先插入，id 最小），ids[4] 是最新（id 最大）
        # 期望返回：id 倒序 = list(reversed(ids))
        r = await self.client.get("/api/me/recent-works", headers=self._auth(token))
        items = r.json()["items"]
        self.assertEqual([it["message_id"] for it in items], list(reversed(ids)))

    async def test_limit_12(self):
        """写 15 条 → 仅返回最新 12 条（id 倒序）"""
        uid, token = await self._register_and_login()
        cid = await self._create_conv(uid)
        ids = []
        for i in range(15):
            mid = await self._add_msg(cid, image_urls=[f"img-{i}.png"])
            ids.append(mid)
        # ids 按生成顺序升序（i=0 最早 id 最小，i=14 最新 id 最大）
        # 期望返回：最新 12 条 = list(reversed(ids))[:12] = ids[-1], ids[-2], ..., ids[-12]
        r = await self.client.get("/api/me/recent-works", headers=self._auth(token))
        items = r.json()["items"]
        self.assertEqual(len(items), 12)
        self.assertEqual([it["message_id"] for it in items], list(reversed(ids))[:12])

    async def test_isolates_other_users(self):
        a_uid, a_token = await self._register_and_login()
        a_cid = await self._create_conv(a_uid)
        for i in range(5):
            await self._add_msg(a_cid, image_urls=[f"a-{i}.png"])

        b_uid, b_token = await self._register_and_login()
        b_cid = await self._create_conv(b_uid)
        for i in range(3):
            await self._add_msg(b_cid, image_urls=[f"b-{i}.png"])

        ra = await self.client.get("/api/me/recent-works", headers=self._auth(a_token))
        rb = await self.client.get("/api/me/recent-works", headers=self._auth(b_token))
        self.assertEqual(len(ra.json()["items"]), 5)
        self.assertEqual(len(rb.json()["items"]), 3)
        # 确认 A 看不到 B 的图
        a_urls = [it["image_url"] for it in ra.json()["items"]]
        self.assertTrue(all(u.startswith("a-") for u in a_urls))

    async def test_excludes_soft_deleted_conv(self):
        uid, token = await self._register_and_login()
        live_cid = await self._create_conv(uid)
        dead_cid = await self._create_conv(uid, deleted=True)
        await self._add_msg(live_cid, image_urls=["live.png"])
        await self._add_msg(dead_cid, image_urls=["dead.png"])

        r = await self.client.get("/api/me/recent-works", headers=self._auth(token))
        items = r.json()["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["image_url"], "live.png")

    async def test_image_count_and_size_fields(self):
        uid, token = await self._register_and_login()
        cid = await self._create_conv(uid)
        urls = ["a.png", "b.png", "c.png"]
        await self._add_msg(
            cid,
            image_urls=urls,
            params={"size": "1024x1024", "quality": "high"},
        )

        r = await self.client.get("/api/me/recent-works", headers=self._auth(token))
        item = r.json()["items"][0]
        self.assertEqual(item["image_count"], 3)
        self.assertEqual(item["all_image_urls"], urls)
        self.assertEqual(item["image_url"], "a.png")
        self.assertEqual(item["size"], "1024x1024")


if __name__ == "__main__":
    unittest.main()
