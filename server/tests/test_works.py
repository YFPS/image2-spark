"""works 路由集成测试

跑：
  cd D:/webProject/image2/server
  python -m unittest tests.test_works
"""
from __future__ import annotations

import os
import unittest
import uuid
from datetime import datetime, timedelta
from urllib.parse import urlparse, urlunparse

from dotenv import load_dotenv

load_dotenv()
os.environ["EMAIL_PROVIDER"] = "null"

_redis_test_url = os.getenv("REDIS_URL_TEST")
if not _redis_test_url:
    _orig = os.getenv("REDIS_URL", "")
    if _orig:
        parsed = urlparse(_orig)
        os.environ["REDIS_URL"] = urlunparse(parsed._replace(path="/15"))
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
        Conversation,
        CreditTransaction,
        EmailVerificationToken,
        Message,
        User,
    )
    from app.redis_client import get_redis  # noqa: E402


def _rand_email() -> str:
    return f"test-{uuid.uuid4().hex[:12]}@example.com"


@unittest.skipUnless(
    _DB_OK and _REDIS_OK and _JWT_OK,
    "DATABASE_URL / REDIS_URL / JWT_SECRET 未配置，跳过集成测试",
)
class WorksTests(unittest.IsolatedAsyncioTestCase):
    created_emails: list[str]
    created_conv_ids: list[int]

    async def asyncSetUp(self) -> None:
        self.created_emails = []
        self.created_conv_ids = []

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
                    await s.execute(delete(User).where(User.id.in_(ids)))
            await s.commit()
        await self.client.__aexit__(None, None, None)
        await get_engine().dispose()
        await get_redis().aclose()

    async def _register_and_login(self) -> tuple[int, str]:
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
        image_urls: list[str] | None = None,
        params: dict | None = None,
    ) -> int:
        factory = get_session_factory()
        async with factory() as s:
            m = Message(
                conversation_id=conv_id,
                role="ai",
                text="",
                image_urls=image_urls,
                params=params,
                status="done",
            )
            s.add(m)
            await s.flush()
            mid = m.id
            await s.commit()
        return mid

    def _auth(self, token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    async def test_unauthorized_returns_401(self):
        r = await self.client.get("/api/me/works")
        self.assertEqual(r.status_code, 401)

    async def test_empty_returns_empty_items(self):
        _uid, token = await self._register_and_login()
        r = await self.client.get("/api/me/works", headers=self._auth(token))
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertEqual(data["items"], [])
        self.assertIsNone(data["next_cursor"])

    async def test_first_page_default_limit_24(self):
        uid, token = await self._register_and_login()
        cid = await self._create_conv(uid)
        for i in range(26):
            await self._add_msg(cid, image_urls=[f"img-{i}.png"])
        r = await self.client.get("/api/me/works", headers=self._auth(token))
        data = r.json()
        self.assertEqual(len(data["items"]), 24)
        self.assertIsNotNone(data["next_cursor"])

    async def test_pagination_with_cursor(self):
        uid, token = await self._register_and_login()
        cid = await self._create_conv(uid)
        for i in range(30):
            await self._add_msg(cid, image_urls=[f"img-{i}.png"])

        r1 = await self.client.get("/api/me/works", headers=self._auth(token))
        d1 = r1.json()
        self.assertEqual(len(d1["items"]), 24)
        cursor = d1["next_cursor"]
        self.assertIsNotNone(cursor)

        r2 = await self.client.get(
            f"/api/me/works?cursor={cursor}", headers=self._auth(token)
        )
        d2 = r2.json()
        self.assertEqual(len(d2["items"]), 6)
        self.assertIsNone(d2["next_cursor"])

    async def test_custom_limit(self):
        uid, token = await self._register_and_login()
        cid = await self._create_conv(uid)
        for i in range(10):
            await self._add_msg(cid, image_urls=[f"img-{i}.png"])
        r = await self.client.get(
            "/api/me/works?limit=5", headers=self._auth(token)
        )
        data = r.json()
        self.assertEqual(len(data["items"]), 5)
        self.assertIsNotNone(data["next_cursor"])

    async def test_limit_over_max_returns_422(self):
        # 项目全局把 RequestValidationError 映射成 400（见 main.py _validation_handler）
        _uid, token = await self._register_and_login()
        r = await self.client.get("/api/me/works?limit=100", headers=self._auth(token))
        self.assertIn(r.status_code, (400, 422))

    async def test_isolates_other_users(self):
        a_uid, a_token = await self._register_and_login()
        a_cid = await self._create_conv(a_uid)
        for i in range(5):
            await self._add_msg(a_cid, image_urls=[f"a-{i}.png"])

        b_uid, _b_token = await self._register_and_login()
        b_cid = await self._create_conv(b_uid)
        for i in range(3):
            await self._add_msg(b_cid, image_urls=[f"b-{i}.png"])

        r = await self.client.get("/api/me/works", headers=self._auth(a_token))
        urls = [it["image_url"] for it in r.json()["items"]]
        self.assertEqual(len(urls), 5)
        self.assertTrue(all(u.startswith("a-") for u in urls))

    async def test_excludes_soft_deleted_conv(self):
        uid, token = await self._register_and_login()
        live_cid = await self._create_conv(uid)
        dead_cid = await self._create_conv(uid, deleted=True)
        await self._add_msg(live_cid, image_urls=["live.png"])
        await self._add_msg(dead_cid, image_urls=["dead.png"])

        r = await self.client.get("/api/me/works", headers=self._auth(token))
        items = r.json()["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["image_url"], "live.png")


if __name__ == "__main__":
    unittest.main()
