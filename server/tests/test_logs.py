"""logs 路由集成测试

跑：
  cd D:/webProject/image2/server
  python -m unittest tests.test_logs
"""
from __future__ import annotations

import os
import unittest
import uuid
from datetime import datetime
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
class LogsTests(unittest.IsolatedAsyncioTestCase):
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

    async def _create_conv(self, user_id: int) -> int:
        factory = get_session_factory()
        async with factory() as s:
            conv = Conversation(user_id=user_id, title="test")
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
        text: str = "",
        image_urls: list[str] | None = None,
    ) -> int:
        factory = get_session_factory()
        async with factory() as s:
            m = Message(
                conversation_id=conv_id,
                role="ai",
                text=text,
                image_urls=image_urls,
                status="done",
            )
            s.add(m)
            await s.flush()
            mid = m.id
            await s.commit()
        return mid

    async def _add_txn(
        self,
        user_id: int,
        *,
        delta: int,
        balance_after: int,
        reason: str,
        ref_type: str | None = None,
        ref_id: str | None = None,
        note: str | None = None,
    ) -> int:
        factory = get_session_factory()
        async with factory() as s:
            tx = CreditTransaction(
                user_id=user_id,
                delta=delta,
                balance_after=balance_after,
                reason=reason,
                ref_type=ref_type,
                ref_id=ref_id,
                note=note,
            )
            s.add(tx)
            await s.flush()
            tid = tx.id
            await s.commit()
        return tid

    def _auth(self, token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    async def test_unauthorized_returns_401(self):
        r = await self.client.get("/api/me/logs")
        self.assertEqual(r.status_code, 401)

    async def test_empty_returns_empty_items(self):
        _uid, token = await self._register_and_login()
        r = await self.client.get("/api/me/logs", headers=self._auth(token))
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertEqual(data["items"], [])
        self.assertIsNone(data["next_cursor"])

    async def test_includes_all_reason_types(self):
        uid, token = await self._register_and_login()
        reasons = ["signup_bonus", "recharge", "admin_grant", "generate", "edit", "refund", "adjust"]
        for i, reason in enumerate(reasons):
            await self._add_txn(uid, delta=1 if i % 2 == 0 else -1, balance_after=10 + i, reason=reason)
        r = await self.client.get("/api/me/logs", headers=self._auth(token))
        items = r.json()["items"]
        self.assertEqual(len(items), 7)
        types = {it["type"] for it in items}
        self.assertEqual(types, set(reasons))

    async def test_ordered_desc_by_id(self):
        uid, token = await self._register_and_login()
        ids = []
        for i in range(5):
            tid = await self._add_txn(uid, delta=1, balance_after=i, reason="adjust")
            ids.append(tid)
        r = await self.client.get("/api/me/logs", headers=self._auth(token))
        items = r.json()["items"]
        self.assertEqual([it["id"] for it in items], list(reversed(ids)))

    async def test_pagination_with_cursor(self):
        uid, token = await self._register_and_login()
        for i in range(60):
            await self._add_txn(uid, delta=1, balance_after=i, reason="adjust")
        r1 = await self.client.get("/api/me/logs", headers=self._auth(token))
        d1 = r1.json()
        self.assertEqual(len(d1["items"]), 50)
        cursor = d1["next_cursor"]
        self.assertIsNotNone(cursor)
        r2 = await self.client.get(
            f"/api/me/logs?cursor={cursor}", headers=self._auth(token)
        )
        d2 = r2.json()
        self.assertEqual(len(d2["items"]), 10)
        self.assertIsNone(d2["next_cursor"])

    async def test_generate_row_has_ref_with_thumbnail(self):
        uid, token = await self._register_and_login()
        cid = await self._create_conv(uid)
        mid = await self._add_msg(
            cid, text="一只猫坐在窗台", image_urls=["thumb.png", "x.png"]
        )
        await self._add_txn(
            uid,
            delta=-1,
            balance_after=4,
            reason="generate",
            ref_type="message",
            ref_id=str(mid),
        )
        r = await self.client.get("/api/me/logs", headers=self._auth(token))
        item = r.json()["items"][0]
        self.assertEqual(item["type"], "generate")
        self.assertIsNotNone(item["ref"])
        self.assertEqual(item["ref"]["kind"], "message")
        self.assertEqual(item["ref"]["message_id"], mid)
        self.assertEqual(item["ref"]["thumbnail_url"], "thumb.png")
        self.assertEqual(item["ref"]["prompt_preview"], "一只猫坐在窗台")

    async def test_recharge_row_has_no_ref(self):
        uid, token = await self._register_and_login()
        await self._add_txn(uid, delta=10, balance_after=15, reason="recharge", note="test pay")
        r = await self.client.get("/api/me/logs", headers=self._auth(token))
        item = r.json()["items"][0]
        self.assertEqual(item["type"], "recharge")
        self.assertIsNone(item["ref"])
        self.assertEqual(item["note"], "test pay")

    async def test_isolates_other_users(self):
        a_uid, a_token = await self._register_and_login()
        for _ in range(3):
            await self._add_txn(a_uid, delta=1, balance_after=10, reason="adjust", note="A")
        b_uid, _b_token = await self._register_and_login()
        for _ in range(5):
            await self._add_txn(b_uid, delta=1, balance_after=10, reason="adjust", note="B")
        r = await self.client.get("/api/me/logs", headers=self._auth(a_token))
        items = r.json()["items"]
        self.assertEqual(len(items), 3)
        self.assertTrue(all(it["note"] == "A" for it in items))


if __name__ == "__main__":
    unittest.main()
