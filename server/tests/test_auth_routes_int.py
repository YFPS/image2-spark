"""auth 路由集成测试

环境（从 server/.env 直接读，不另建 test 库）：
- DB → image2（与开发共用；测试用例自带随机邮箱避免冲突，tearDown 清理自己的痕迹）
- Redis → 单独 DB 15 (REDIS_URL_TEST 优先；否则把 REDIS_URL 的 db 段改成 15)
- 跑前先 `pip install -r requirements.txt` 并确保 alembic upgrade head 已执行

注意：本测试集走真实网络（RDS + NAS Redis），属于"集成测试"，比单元测试慢。
如缺 DATABASE_URL 或 Redis 不通，所有用例 skip。
"""
from __future__ import annotations

import asyncio
import os
import unittest
import uuid
from typing import Any
from urllib.parse import urlparse, urlunparse

from dotenv import load_dotenv

load_dotenv()  # 读 server/.env

# 用专用 Redis DB 15 跑测试，不干扰开发用的 DB 0
_redis_test_url = os.getenv("REDIS_URL_TEST")
if not _redis_test_url:
    _orig = os.getenv("REDIS_URL", "")
    if _orig:
        parsed = urlparse(_orig)
        new_path = "/15"
        os.environ["REDIS_URL"] = urlunparse(parsed._replace(path=new_path))
else:
    os.environ["REDIS_URL"] = _redis_test_url

# 必须在 import app 之前注入 env
_DB_OK = bool(os.getenv("DATABASE_URL"))
_REDIS_OK = bool(os.getenv("REDIS_URL"))
_JWT_OK = bool(os.getenv("JWT_SECRET"))

if _DB_OK and _REDIS_OK and _JWT_OK:
    import httpx  # noqa: E402
    from sqlalchemy import delete  # noqa: E402

    from app.db import get_session_factory  # noqa: E402
    from app.main import app  # noqa: E402
    from app.models import CreditTransaction, User  # noqa: E402
    from app.redis_client import get_redis  # noqa: E402


def _rand_email() -> str:
    return f"test-{uuid.uuid4().hex[:12]}@example.com"


@unittest.skipUnless(_DB_OK and _REDIS_OK and _JWT_OK, "DATABASE_URL / REDIS_URL / JWT_SECRET 未配置，跳过集成测试")
class AuthRoutesIntegrationTests(unittest.IsolatedAsyncioTestCase):
    created_emails: list[str]

    async def asyncSetUp(self) -> None:
        self.created_emails = []
        # 清 Redis test DB
        redis = get_redis()
        await redis.flushdb()

        transport = httpx.ASGITransport(app=app)
        self.client = httpx.AsyncClient(transport=transport, base_url="http://test")
        # 触发 startup（探活）
        await self.client.__aenter__()

    async def asyncTearDown(self) -> None:
        # 删测试创建的 user + 流水（按邮箱）
        if self.created_emails:
            factory = get_session_factory()
            async with factory() as s:
                rows = await s.execute(
                    User.__table__.select().where(User.email.in_(self.created_emails))
                )
                ids = [r.id for r in rows.fetchall()]
                if ids:
                    await s.execute(delete(CreditTransaction).where(CreditTransaction.user_id.in_(ids)))
                    await s.execute(delete(User).where(User.id.in_(ids)))
                    await s.commit()
        await self.client.__aexit__(None, None, None)

    def _track(self, email: str) -> str:
        self.created_emails.append(email.lower().strip())
        return email

    # ============ 注册 ============

    async def test_register_success_grants_credits_and_writes_ledger(self):
        email = self._track(_rand_email())
        r = await self.client.post(
            "/api/auth/register",
            json={"email": email, "password": "Hunter2_pw"},
        )
        self.assertEqual(r.status_code, 201, r.text)
        body = r.json()
        self.assertIn("access_token", body)
        self.assertEqual(body["user"]["email"], email.lower())
        self.assertEqual(body["user"]["credits"], 5)
        self.assertEqual(body["user"]["role"], "user")
        # 流水表应有一条 signup_bonus
        factory = get_session_factory()
        async with factory() as s:
            row = (await s.execute(
                CreditTransaction.__table__.select().where(
                    CreditTransaction.user_id == body["user"]["id"]
                )
            )).fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row.reason, "signup_bonus")
            self.assertEqual(row.delta, 5)
            self.assertEqual(row.balance_after, 5)

    async def test_register_duplicate_email_409(self):
        email = self._track(_rand_email())
        ok = await self.client.post("/api/auth/register", json={"email": email, "password": "abc12345"})
        self.assertEqual(ok.status_code, 201)
        dup = await self.client.post("/api/auth/register", json={"email": email, "password": "abc12345"})
        self.assertEqual(dup.status_code, 409)
        self.assertEqual(dup.json()["error"]["code"], "email_taken")

    async def test_register_email_case_insensitive_collision(self):
        email = _rand_email()
        self._track(email)
        r1 = await self.client.post("/api/auth/register", json={"email": email, "password": "abc12345"})
        self.assertEqual(r1.status_code, 201)
        r2 = await self.client.post(
            "/api/auth/register",
            json={"email": email.upper(), "password": "abc12345"},
        )
        self.assertEqual(r2.status_code, 409)

    async def test_register_weak_password_400(self):
        r = await self.client.post(
            "/api/auth/register",
            json={"email": _rand_email(), "password": "short"},
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["error"]["code"], "password_weak")

    async def test_register_invalid_email_400(self):
        r = await self.client.post(
            "/api/auth/register",
            json={"email": "not-email", "password": "abc12345"},
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["error"]["code"], "email_invalid")

    # ============ 登录 ============

    async def test_login_success_updates_last_login(self):
        email = self._track(_rand_email())
        await self.client.post("/api/auth/register", json={"email": email, "password": "abc12345"})
        r = await self.client.post("/api/auth/login", json={"email": email, "password": "abc12345"})
        self.assertEqual(r.status_code, 200)
        self.assertIn("access_token", r.json())
        self.assertIsNotNone(r.json()["user"]["last_login_at"])

    async def test_login_wrong_password_401(self):
        email = self._track(_rand_email())
        await self.client.post("/api/auth/register", json={"email": email, "password": "abc12345"})
        r = await self.client.post("/api/auth/login", json={"email": email, "password": "wrongpw1"})
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.json()["error"]["code"], "invalid_credentials")

    async def test_login_nonexistent_returns_same_401(self):
        r = await self.client.post(
            "/api/auth/login",
            json={"email": _rand_email(), "password": "abc12345"},
        )
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.json()["error"]["code"], "invalid_credentials")

    async def test_login_locks_after_5_failures(self):
        email = self._track(_rand_email())
        await self.client.post("/api/auth/register", json={"email": email, "password": "abc12345"})
        for _ in range(5):
            await self.client.post("/api/auth/login", json={"email": email, "password": "wrong"})
        # 第 6 次即便密码正确也被锁
        r = await self.client.post("/api/auth/login", json={"email": email, "password": "abc12345"})
        self.assertEqual(r.status_code, 429)
        body = r.json()
        self.assertEqual(body["error"]["code"], "too_many_attempts")
        self.assertIn("lock_remaining", body["error"])

    async def test_disabled_user_login_403(self):
        email = self._track(_rand_email())
        await self.client.post("/api/auth/register", json={"email": email, "password": "abc12345"})
        # 直接改 DB 把账号封了
        factory = get_session_factory()
        async with factory() as s:
            user = (await s.execute(User.__table__.select().where(User.email == email.lower()))).fetchone()
            await s.execute(
                User.__table__.update().where(User.id == user.id).values(disabled=True)
            )
            await s.commit()
        r = await self.client.post("/api/auth/login", json={"email": email, "password": "abc12345"})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json()["error"]["code"], "account_disabled")

    # ============ /me + logout ============

    async def test_me_with_valid_token(self):
        email = self._track(_rand_email())
        reg = await self.client.post("/api/auth/register", json={"email": email, "password": "abc12345"})
        token = reg.json()["access_token"]
        r = await self.client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["email"], email.lower())

    async def test_me_without_token_401(self):
        r = await self.client.get("/api/auth/me")
        self.assertEqual(r.status_code, 401)

    async def test_me_with_bad_token_401(self):
        r = await self.client.get("/api/auth/me", headers={"Authorization": "Bearer not.a.jwt"})
        self.assertEqual(r.status_code, 401)

    async def test_logout_blacklists_token(self):
        email = self._track(_rand_email())
        reg = await self.client.post("/api/auth/register", json={"email": email, "password": "abc12345"})
        token = reg.json()["access_token"]
        out = await self.client.post("/api/auth/logout", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(out.status_code, 204)
        r = await self.client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(r.status_code, 401)

    async def test_disabled_midway_existing_token_403(self):
        email = self._track(_rand_email())
        reg = await self.client.post("/api/auth/register", json={"email": email, "password": "abc12345"})
        token = reg.json()["access_token"]
        uid = reg.json()["user"]["id"]
        factory = get_session_factory()
        async with factory() as s:
            await s.execute(User.__table__.update().where(User.id == uid).values(disabled=True))
            await s.commit()
        r = await self.client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(r.status_code, 403)

    async def test_concurrent_register_same_email_one_wins(self):
        email = self._track(_rand_email())

        async def _one() -> int:
            r = await self.client.post(
                "/api/auth/register", json={"email": email, "password": "abc12345"}
            )
            return r.status_code

        codes = await asyncio.gather(_one(), _one())
        # 一个 201，一个 409；都不应是 500
        self.assertEqual(sorted(codes), [201, 409])


if __name__ == "__main__":
    unittest.main()
