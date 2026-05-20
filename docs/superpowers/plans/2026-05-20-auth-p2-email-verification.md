# Auth P2 Email Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add email verification before image generation/editing, move signup bonus to verification success, remove the disabled-login side channel, and shorten new JWTs to 24 hours.

**Architecture:** Keep auth responsibilities split by boundary: `auth_service.py` keeps passwords/JWT/login, `email_provider.py` sends mail, and `email_verification_service.py` owns token lifecycle plus verification-time signup bonus. Routes stay thin and call services; image routes use a small `require_verified_user()` gate before any upstream or billing work.

**Tech Stack:** FastAPI, SQLAlchemy 2 async ORM, Alembic, Redis, slowapi, PyJWT, React 18, TypeScript, Vite.

---

## File Structure

- Modify `server/app/config.py`: add email provider settings, `APP_ENV`, and `JWT_EXP_HOURS` compatibility.
- Modify `server/app/models.py`: add user verification fields and `EmailVerificationToken`.
- Create `server/alembic/versions/0003_email_verification.py`: schema migration and legacy user backfill.
- Create `server/app/email_provider.py`: provider protocol plus console, null, and Aliyun DirectMail provider skeleton.
- Create `server/app/email_verification_service.py`: token hash lifecycle, verify flow, resend flow, verified-user dependency helper.
- Modify `server/app/auth_service.py`: JWT TTL by hours, registration without immediate bonus, disabled login branch merged into invalid credentials.
- Modify `server/app/routers/auth.py`: register response flag, verify email endpoint, resend endpoint.
- Modify `server/app/routers/images.py`: reject unverified users before generate/edit side effects.
- Modify `server/app/schemas.py`: auth response/request schemas and `UserPublic` verification fields.
- Modify `server/app/main.py`: startup validation for production email provider config.
- Modify `server/tests/test_auth_service_unit.py`: JWT hour TTL and disabled-login behavior coverage.
- Create `server/tests/test_email_verification_service_unit.py`: token hashing and bonus idempotency unit tests.
- Modify `server/tests/test_auth_routes_int.py`: registration, verification, resend, disabled-login, and JWT response expectations.
- Modify `client/src/api/auth.ts`: add verification fields and verify/resend API functions.
- Modify `client/src/auth/AuthContext.tsx`: expose verification actions and store `verification_email_sent`.
- Modify `client/src/auth/AuthOverlay.tsx`: show register success verification state and remove disabled-specific login copy.
- Modify `client/src/auth/UserBadge.tsx`: show verification status and resend action.
- Modify `client/src/api/gptImage.ts`: map `email_not_verified` to friendly client errors.
- Modify `client/src/App.tsx`: show a verification prompt when generation/edit is blocked.

---

## Task 1: Config And JWT TTL Tests

**Files:**
- Modify: `server/app/config.py`
- Modify: `server/app/auth_service.py`
- Modify: `server/tests/test_auth_service_unit.py`

- [ ] **Step 1: Add failing JWT hour TTL tests**

Append this test case to `server/tests/test_auth_service_unit.py`:

```python
class JwtTtlConfigTests(unittest.TestCase):
    def setUp(self):
        get_settings.cache_clear()
        os.environ["JWT_SECRET"] = "x" * 64

    def tearDown(self):
        os.environ.pop("JWT_EXP_HOURS", None)
        os.environ.pop("JWT_EXP_DAYS", None)
        get_settings.cache_clear()

    def test_jwt_exp_hours_controls_expires_in(self):
        os.environ["JWT_EXP_HOURS"] = "24"
        get_settings.cache_clear()
        token, exp_in, _jti = create_jwt(user_id=9, email="ttl@example.com", role="user")
        payload = decode_jwt(token)
        self.assertEqual(payload["sub"], "9")
        self.assertGreaterEqual(exp_in, 86_390)
        self.assertLessEqual(exp_in, 86_400)

    def test_legacy_jwt_exp_days_is_still_read_when_hours_missing(self):
        os.environ.pop("JWT_EXP_HOURS", None)
        os.environ["JWT_EXP_DAYS"] = "2"
        get_settings.cache_clear()
        _token, exp_in, _jti = create_jwt(user_id=9, email="ttl@example.com", role="user")
        self.assertGreaterEqual(exp_in, 172_790)
        self.assertLessEqual(exp_in, 172_800)
```

- [ ] **Step 2: Run the focused unit tests and confirm they fail**

Run:

```powershell
cd server
python -m unittest tests.test_auth_service_unit.JwtTtlConfigTests
```

Expected: failure mentioning `Settings` has no `jwt_exp_hours` or token expiry remains about 7 days.

- [ ] **Step 3: Add config fields**

In `server/app/config.py`, replace the existing `jwt_exp_days` assignment with:

```python
        self.app_env: str = os.getenv("APP_ENV", "development").strip().lower() or "development"
        raw_jwt_hours = os.getenv("JWT_EXP_HOURS")
        if raw_jwt_hours is not None and raw_jwt_hours.strip():
            self.jwt_exp_hours: int = int(raw_jwt_hours)
        else:
            self.jwt_exp_hours = int(os.getenv("JWT_EXP_DAYS", "1")) * 24
        self.jwt_exp_days: int = max(1, self.jwt_exp_hours // 24)
```

Add these email settings after the rate-limit settings:

```python
        self.email_provider: str = os.getenv("EMAIL_PROVIDER", "console").strip().lower() or "console"
        self.email_from_address: str = os.getenv("EMAIL_FROM_ADDRESS", "").strip()
        self.email_from_alias: str = os.getenv("EMAIL_FROM_ALIAS", "image2").strip() or "image2"
        self.email_verify_base_url: str = os.getenv(
            "EMAIL_VERIFY_BASE_URL", "http://127.0.0.1:5173/verify-email"
        ).strip()
        self.email_verify_token_ttl_hours: int = int(os.getenv("EMAIL_VERIFY_TOKEN_TTL_HOURS", "24"))
        self.email_resend_cooldown_seconds: int = int(os.getenv("EMAIL_RESEND_COOLDOWN_SECONDS", "60"))
        self.email_verify_daily_limit: int = int(os.getenv("EMAIL_VERIFY_DAILY_LIMIT", "5"))
        self.rate_limit_verify_email: str = os.getenv("RATE_LIMIT_VERIFY_EMAIL", "5/hour")
        self.rate_limit_resend_verification: str = os.getenv("RATE_LIMIT_RESEND_VERIFICATION", "5/hour")

        self.aliyun_directmail_access_key_id: str = os.getenv(
            "ALIYUN_DIRECTMAIL_ACCESS_KEY_ID", ""
        ).strip()
        self.aliyun_directmail_access_key_secret: str = os.getenv(
            "ALIYUN_DIRECTMAIL_ACCESS_KEY_SECRET", ""
        ).strip()
        self.aliyun_directmail_account_name: str = os.getenv(
            "ALIYUN_DIRECTMAIL_ACCOUNT_NAME", ""
        ).strip()
        self.aliyun_directmail_region: str = os.getenv(
            "ALIYUN_DIRECTMAIL_REGION", "cn-hangzhou"
        ).strip() or "cn-hangzhou"
```

- [ ] **Step 4: Change JWT creation to use hours**

In `server/app/auth_service.py`, update `create_jwt()`:

```python
    exp = now + timedelta(hours=settings.jwt_exp_hours)
```

- [ ] **Step 5: Run the JWT tests and confirm they pass**

Run:

```powershell
cd server
python -m unittest tests.test_auth_service_unit.JwtTtlConfigTests
```

Expected: `Ran 2 tests` and `OK`.

- [ ] **Step 6: Commit**

Run:

```powershell
git add server/app/config.py server/app/auth_service.py server/tests/test_auth_service_unit.py
git commit -m "feat(auth): configure jwt ttl in hours"
```

---

## Task 2: Database Migration And ORM Models

**Files:**
- Modify: `server/app/models.py`
- Create: `server/alembic/versions/0003_email_verification.py`
- Test: `server/tests/test_email_verification_service_unit.py`

- [ ] **Step 1: Add model import smoke test**

Create `server/tests/test_email_verification_service_unit.py` with this first test:

```python
"""邮箱验证服务单测。"""
from __future__ import annotations

import unittest

from app.models import EmailVerificationToken, User


class EmailVerificationModelTests(unittest.TestCase):
    def test_user_has_verification_columns(self):
        self.assertIn("email_verified_at", User.__table__.columns)
        self.assertIn("signup_bonus_granted_at", User.__table__.columns)

    def test_token_model_has_hash_and_expiry_columns(self):
        self.assertEqual(EmailVerificationToken.__tablename__, "email_verification_tokens")
        self.assertIn("token_hash", EmailVerificationToken.__table__.columns)
        self.assertIn("expires_at", EmailVerificationToken.__table__.columns)
        self.assertIn("used_at", EmailVerificationToken.__table__.columns)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the model smoke test and confirm it fails**

Run:

```powershell
cd server
python -m unittest tests.test_email_verification_service_unit.EmailVerificationModelTests
```

Expected: import failure for `EmailVerificationToken` or missing user columns.

- [ ] **Step 3: Extend ORM models**

In `server/app/models.py`, add `email_verified_at` and `signup_bonus_granted_at` to `User` after `disabled`:

```python
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    signup_bonus_granted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
```

Add this class after `CreditTransaction`:

```python
class EmailVerificationToken(Base):
    """邮箱验证 token：只存 hash，明文 token 只通过邮件发送。"""

    __tablename__ = "email_verification_tokens"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uk_evt_token_hash"),
        Index("idx_evt_user_created", "user_id", "created_at"),
        Index("idx_evt_expires", "expires_at"),
        {
            "mysql_engine": "InnoDB",
            "mysql_charset": "utf8mb4",
            "mysql_collate": "utf8mb4_0900_ai_ci",
        },
    )

    id: Mapped[int] = mapped_column(MyBigInt(unsigned=True), primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        MyBigInt(unsigned=True),
        ForeignKey("users.id", ondelete="CASCADE", name="fk_evt_user"),
        nullable=False,
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    purpose: Mapped[str] = mapped_column(
        Enum("verify_email", name="email_verification_purpose"),
        nullable=False,
        default="verify_email",
        server_default="verify_email",
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp()
    )
```

- [ ] **Step 4: Create Alembic migration**

Create `server/alembic/versions/0003_email_verification.py`:

```python
"""email verification

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-20
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MYSQL_TABLE_KW = {
    "mysql_engine": "InnoDB",
    "mysql_charset": "utf8mb4",
    "mysql_collate": "utf8mb4_0900_ai_ci",
}


def upgrade() -> None:
    op.add_column("users", sa.Column("email_verified_at", sa.DateTime(), nullable=True))
    op.add_column("users", sa.Column("signup_bonus_granted_at", sa.DateTime(), nullable=True))

    op.create_table(
        "email_verification_tokens",
        sa.Column("id", mysql.BIGINT(unsigned=True), primary_key=True, autoincrement=True),
        sa.Column("user_id", mysql.BIGINT(unsigned=True), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column(
            "purpose",
            sa.Enum("verify_email", name="email_verification_purpose"),
            nullable=False,
            server_default="verify_email",
        ),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used_at", sa.DateTime(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_evt_user", ondelete="CASCADE"
        ),
        sa.UniqueConstraint("token_hash", name="uk_evt_token_hash"),
        **MYSQL_TABLE_KW,
    )
    op.create_index("idx_evt_user_created", "email_verification_tokens", ["user_id", "created_at"])
    op.create_index("idx_evt_expires", "email_verification_tokens", ["expires_at"])

    op.execute(
        """
        UPDATE users
        SET email_verified_at = COALESCE(email_verified_at, created_at)
        WHERE email_verified_at IS NULL
        """
    )
    op.execute(
        """
        UPDATE users u
        SET signup_bonus_granted_at = COALESCE(signup_bonus_granted_at, u.created_at)
        WHERE signup_bonus_granted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM credit_transactions ct
            WHERE ct.user_id = u.id AND ct.reason = 'signup_bonus'
          )
        """
    )


def downgrade() -> None:
    op.drop_index("idx_evt_expires", table_name="email_verification_tokens")
    op.drop_index("idx_evt_user_created", table_name="email_verification_tokens")
    op.drop_table("email_verification_tokens")
    op.drop_column("users", "signup_bonus_granted_at")
    op.drop_column("users", "email_verified_at")
```

- [ ] **Step 5: Run model tests**

Run:

```powershell
cd server
python -m unittest tests.test_email_verification_service_unit.EmailVerificationModelTests
```

Expected: `Ran 2 tests` and `OK`.

- [ ] **Step 6: Commit**

Run:

```powershell
git add server/app/models.py server/alembic/versions/0003_email_verification.py server/tests/test_email_verification_service_unit.py
git commit -m "feat(auth): add email verification schema"
```

---

## Task 3: Email Provider Layer

**Files:**
- Create: `server/app/email_provider.py`
- Modify: `server/tests/test_email_verification_service_unit.py`
- Modify: `server/app/main.py`

- [ ] **Step 1: Add provider tests**

Append this test case to `server/tests/test_email_verification_service_unit.py`:

```python
import asyncio
import os

from app.config import get_settings
from app.email_provider import ConsoleEmailProvider, NullEmailProvider, get_email_provider


class EmailProviderTests(unittest.TestCase):
    def tearDown(self):
        os.environ.pop("EMAIL_PROVIDER", None)
        get_settings.cache_clear()

    def test_null_provider_records_no_messages(self):
        async def _run():
            provider = NullEmailProvider()
            await provider.send_verification_email(
                to_email="user@example.com",
                nickname="User",
                verify_url="https://example.com/verify-email?token=abc",
                expires_hours=24,
            )
            self.assertEqual(provider.sent_count, 1)

        asyncio.run(_run())

    def test_get_provider_uses_console_by_default(self):
        os.environ["EMAIL_PROVIDER"] = "console"
        get_settings.cache_clear()
        self.assertIsInstance(get_email_provider(), ConsoleEmailProvider)
```

- [ ] **Step 2: Run provider tests and confirm they fail**

Run:

```powershell
cd server
python -m unittest tests.test_email_verification_service_unit.EmailProviderTests
```

Expected: import failure for `app.email_provider`.

- [ ] **Step 3: Create provider layer**

Create `server/app/email_provider.py`:

```python
"""邮箱发送 provider。生产默认阿里云，开发和测试可用 console/null。"""
from __future__ import annotations

import logging
from typing import Protocol

import httpx

from .config import get_settings

logger = logging.getLogger(__name__)


class EmailProvider(Protocol):
    async def send_verification_email(
        self,
        *,
        to_email: str,
        nickname: str,
        verify_url: str,
        expires_hours: int,
    ) -> None:
        raise NotImplementedError


class ConsoleEmailProvider:
    async def send_verification_email(
        self,
        *,
        to_email: str,
        nickname: str,
        verify_url: str,
        expires_hours: int,
    ) -> None:
        logger.warning(
            "邮箱验证链接 provider=console to=%s nickname=%s expires_hours=%s url=%s",
            to_email,
            nickname,
            expires_hours,
            verify_url,
        )


class NullEmailProvider:
    def __init__(self) -> None:
        self.sent_count = 0

    async def send_verification_email(
        self,
        *,
        to_email: str,
        nickname: str,
        verify_url: str,
        expires_hours: int,
    ) -> None:
        self.sent_count += 1


class AliyunDirectMailProvider:
    async def send_verification_email(
        self,
        *,
        to_email: str,
        nickname: str,
        verify_url: str,
        expires_hours: int,
    ) -> None:
        settings = get_settings()
        subject = "验证你的 image2 邮箱"
        body = (
            f"{nickname}，请打开以下链接完成邮箱验证。"
            f"链接 {expires_hours} 小时内有效：{verify_url}"
        )
        params = {
            "AccountName": settings.aliyun_directmail_account_name,
            "FromAlias": settings.email_from_alias,
            "AddressType": "1",
            "ToAddress": to_email,
            "Subject": subject,
            "HtmlBody": body,
        }
        headers = {
            "X-Image2-Provider": "aliyun_directmail",
        }
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                "https://dm.aliyuncs.com/",
                data=params,
                headers=headers,
            )
        response.raise_for_status()


def get_email_provider() -> EmailProvider:
    provider = get_settings().email_provider
    if provider == "console":
        return ConsoleEmailProvider()
    if provider == "null":
        return NullEmailProvider()
    if provider == "aliyun_directmail":
        return AliyunDirectMailProvider()
    raise RuntimeError(f"未知 EMAIL_PROVIDER：{provider}")
```

- [ ] **Step 4: Add production startup guard**

In `server/app/main.py`, inside `lifespan()` after `JWT_SECRET` check, add:

```python
    if settings.app_env == "production":
        if settings.email_provider in {"console", "null"}:
            raise RuntimeError("生产环境禁止使用 console/null 邮件 provider")
        if not settings.email_verify_base_url.startswith("https://"):
            raise RuntimeError("生产环境 EMAIL_VERIFY_BASE_URL 必须使用 https")
    if settings.email_provider == "aliyun_directmail":
        required = [
            settings.email_from_address,
            settings.aliyun_directmail_access_key_id,
            settings.aliyun_directmail_access_key_secret,
            settings.aliyun_directmail_account_name,
        ]
        if not all(required):
            raise RuntimeError("阿里云邮件推送配置不完整")
```

- [ ] **Step 5: Run provider tests**

Run:

```powershell
cd server
python -m unittest tests.test_email_verification_service_unit.EmailProviderTests
```

Expected: `Ran 2 tests` and `OK`.

- [ ] **Step 6: Commit**

Run:

```powershell
git add server/app/email_provider.py server/app/main.py server/tests/test_email_verification_service_unit.py
git commit -m "feat(auth): add email provider layer"
```

---

## Task 4: Email Verification Service

**Files:**
- Create: `server/app/email_verification_service.py`
- Modify: `server/tests/test_email_verification_service_unit.py`

- [ ] **Step 1: Add pure function tests for token hashing and URLs**

Append this test case to `server/tests/test_email_verification_service_unit.py`:

```python
from app.email_verification_service import build_verify_url, hash_verification_token


class EmailVerificationPureFunctionTests(unittest.TestCase):
    def test_hash_verification_token_is_sha256_hex(self):
        self.assertEqual(
            hash_verification_token("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        )

    def test_build_verify_url_adds_token_query(self):
        url = build_verify_url("https://example.com/verify-email", "abc123")
        self.assertEqual(url, "https://example.com/verify-email?token=abc123")
```

- [ ] **Step 2: Run pure function tests and confirm they fail**

Run:

```powershell
cd server
python -m unittest tests.test_email_verification_service_unit.EmailVerificationPureFunctionTests
```

Expected: import failure for `app.email_verification_service`.

- [ ] **Step 3: Create verification service**

Create `server/app/email_verification_service.py`:

```python
"""邮箱验证 token 生命周期与验证后 signup bonus 发放。"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .email_provider import get_email_provider
from .models import CreditTransaction, EmailVerificationToken, User


class VerificationError(Exception):
    def __init__(self, code: str, http_status: int = 400):
        super().__init__(code)
        self.code = code
        self.http_status = http_status


def hash_verification_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def build_verify_url(base_url: str, token: str) -> str:
    separator = "&" if "?" in base_url else "?"
    return f"{base_url}{separator}{urlencode({'token': token})}"


def _utcnow() -> datetime:
    return datetime.now(tz=timezone.utc).replace(tzinfo=None)


def _new_token() -> str:
    return secrets.token_urlsafe(32)


async def create_verification_token(session: AsyncSession, user: User) -> str:
    settings = get_settings()
    token = _new_token()
    row = EmailVerificationToken(
        user_id=user.id,
        token_hash=hash_verification_token(token),
        expires_at=_utcnow() + timedelta(hours=settings.email_verify_token_ttl_hours),
    )
    session.add(row)
    await session.flush()
    return token


async def send_verification_email(user: User, token: str) -> None:
    settings = get_settings()
    verify_url = build_verify_url(settings.email_verify_base_url, token)
    provider = get_email_provider()
    await provider.send_verification_email(
        to_email=user.email,
        nickname=user.nickname,
        verify_url=verify_url,
        expires_hours=settings.email_verify_token_ttl_hours,
    )


async def verify_email_token(session: AsyncSession, token: str) -> User:
    token_hash = hash_verification_token(token)
    token_row = (
        await session.execute(
            select(EmailVerificationToken).where(
                EmailVerificationToken.token_hash == token_hash
            ).with_for_update()
        )
    ).scalar_one_or_none()
    if token_row is None:
        raise VerificationError("verification_token_invalid")

    user = (
        await session.execute(
            select(User).where(User.id == token_row.user_id).with_for_update()
        )
    ).scalar_one()

    now = _utcnow()
    if token_row.used_at is not None:
        if user.email_verified_at is not None:
            return user
        raise VerificationError("verification_token_invalid")
    if token_row.expires_at < now:
        if user.email_verified_at is not None:
            return user
        token_row.used_at = now
        await session.commit()
        raise VerificationError("verification_token_expired")

    if user.email_verified_at is None:
        user.email_verified_at = now

    settings = get_settings()
    if user.signup_bonus_granted_at is None:
        user.signup_bonus_granted_at = now
        bonus = settings.signup_bonus_credits
        if bonus > 0:
            user.credits += bonus
            session.add(
                CreditTransaction(
                    user_id=user.id,
                    delta=bonus,
                    balance_after=user.credits,
                    reason="signup_bonus",
                    note="邮箱验证后注册赠送",
                )
            )

    await session.execute(
        update(EmailVerificationToken)
        .where(
            EmailVerificationToken.user_id == user.id,
            EmailVerificationToken.used_at.is_(None),
        )
        .values(used_at=now)
    )
    await session.commit()
    await session.refresh(user)
    return user


async def resend_verification(session: AsyncSession, email: str) -> bool:
    user = (
        await session.execute(select(User).where(User.email == email.strip().lower()))
    ).scalar_one_or_none()
    if user is None or user.email_verified_at is not None:
        return False
    token = await create_verification_token(session, user)
    await session.commit()
    await send_verification_email(user, token)
    return True


def require_verified_user(user: User) -> None:
    if user.email_verified_at is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": {"code": "email_not_verified", "message": "请先验证邮箱"}},
        )
```

- [ ] **Step 4: Run unit tests**

Run:

```powershell
cd server
python -m unittest tests.test_email_verification_service_unit
```

Expected: all tests in this file pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add server/app/email_verification_service.py server/tests/test_email_verification_service_unit.py
git commit -m "feat(auth): add email verification service"
```

---

## Task 5: Auth Schemas And Routes

**Files:**
- Modify: `server/app/schemas.py`
- Modify: `server/app/auth_service.py`
- Modify: `server/app/routers/auth.py`
- Modify: `server/tests/test_auth_routes_int.py`

- [ ] **Step 1: Update route tests for register and disabled login**

In `server/tests/test_auth_routes_int.py`, change `test_register_success_grants_credits_and_writes_ledger` into:

```python
    async def test_register_success_creates_unverified_user_without_bonus(self):
        email = self._track(_rand_email())
        r = await self.client.post(
            "/api/auth/register",
            json={"email": email, "password": "Hunter2_pw"},
        )
        self.assertEqual(r.status_code, 201, r.text)
        body = r.json()
        self.assertIn("access_token", body)
        self.assertEqual(body["verification_email_sent"], True)
        self.assertEqual(body["user"]["email"], email.lower())
        self.assertEqual(body["user"]["credits"], 0)
        self.assertIsNone(body["user"]["email_verified_at"])
        self.assertEqual(body["user"]["verification_required"], True)
```

Change `test_disabled_user_login_403` into:

```python
    async def test_disabled_user_login_returns_invalid_credentials(self):
        email = self._track(_rand_email())
        await self.client.post("/api/auth/register", json={"email": email, "password": "abc12345"})
        factory = get_session_factory()
        async with factory() as s:
            user = (await s.execute(User.__table__.select().where(User.email == email.lower()))).fetchone()
            await s.execute(
                User.__table__.update().where(User.id == user.id).values(disabled=True)
            )
            await s.commit()
        r = await self.client.post("/api/auth/login", json={"email": email, "password": "abc12345"})
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.json()["error"]["code"], "invalid_credentials")
```

- [ ] **Step 2: Run changed route tests and confirm they fail**

Run:

```powershell
cd server
python -m unittest tests.test_auth_routes_int.AuthRoutesIntegrationTests.test_register_success_creates_unverified_user_without_bonus tests.test_auth_routes_int.AuthRoutesIntegrationTests.test_disabled_user_login_returns_invalid_credentials
```

Expected: failures because register still grants credits and disabled login returns `403`.

- [ ] **Step 3: Extend schemas**

In `server/app/schemas.py`, add:

```python
class VerifyEmailRequest(BaseModel):
    token: str = Field(min_length=16, max_length=256)


class ResendVerificationRequest(BaseModel):
    email: EmailStr
```

Modify `UserPublic`:

```python
    email_verified_at: datetime | None = None
    verification_required: bool = False
```

Modify `TokenResponse`:

```python
    verification_email_sent: bool = True
```

- [ ] **Step 4: Change user public serialization**

In `server/app/routers/auth.py`, update `_user_public()`:

```python
        email_verified_at=u.email_verified_at,
        verification_required=u.email_verified_at is None,
```

- [ ] **Step 5: Change registration service**

In `server/app/auth_service.py`, update `register_user()` so it creates users without credits and without `signup_bonus` ledger:

```python
    user = User(
        email=email_norm,
        password_hash=hash_password(password),
        nickname=nick,
        role="user",
        credits=0,
    )
    session.add(user)
    try:
        await session.flush()
    except IntegrityError as e:
        await session.rollback()
        raise AuthError("email_taken", http_status=409) from e
    return user
```

Remove the old `CreditTransaction` creation and `await session.commit()` from this function. The route will own the commit after token creation.

- [ ] **Step 6: Change disabled login branch**

In `server/app/auth_service.py`, replace:

```python
    if user.disabled:
        # 封号不计入失败次数（你密码是对的）
        raise AuthError("account_disabled", http_status=403)
```

with:

```python
    if user.disabled:
        await record_login_failure(redis, email_norm)
        raise AuthError("invalid_credentials", http_status=401)
```

- [ ] **Step 7: Add verify and resend routes**

In `server/app/routers/auth.py`, import:

```python
from ..auth_service import normalize_email
from ..email_verification_service import (
    VerificationError,
    create_verification_token,
    resend_verification,
    send_verification_email,
    verify_email_token,
)
from ..schemas import ResendVerificationRequest, VerifyEmailRequest
```

Update `register()`:

```python
    verification_email_sent = True
    try:
        user = await register_user(
            db, email=req.email, password=req.password, nickname=req.nickname
        )
        token_plain = await create_verification_token(db, user)
        await db.commit()
        await db.refresh(user)
        try:
            await send_verification_email(user, token_plain)
        except Exception:  # noqa: BLE001
            logger.exception("发送验证邮件失败 user_id=%s", user.id)
            verification_email_sent = False
    except AuthError as e:
        return _auth_error_response(e)
```

Pass `verification_email_sent=verification_email_sent` into `TokenResponse`.

Add routes:

```python
@router.post("/verify-email")
async def verify_email(
    req: VerifyEmailRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        user = await verify_email_token(db, req.token)
    except VerificationError as e:
        return JSONResponse(
            status_code=e.http_status,
            content={"error": {"code": e.code, "message": e.code}},
        )
    return {"ok": True, "user": _user_public(user).model_dump(mode="json")}


@router.post("/resend-verification")
async def resend_verification_email(
    req: ResendVerificationRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        await resend_verification(db, normalize_email(req.email))
    except Exception:  # noqa: BLE001
        logger.exception("重发验证邮件失败")
    return {"ok": True}
```

- [ ] **Step 8: Run route tests**

Run:

```powershell
cd server
python -m unittest tests.test_auth_routes_int.AuthRoutesIntegrationTests.test_register_success_creates_unverified_user_without_bonus tests.test_auth_routes_int.AuthRoutesIntegrationTests.test_disabled_user_login_returns_invalid_credentials
```

Expected: both tests pass.

- [ ] **Step 9: Commit**

Run:

```powershell
git add server/app/schemas.py server/app/auth_service.py server/app/routers/auth.py server/tests/test_auth_routes_int.py
git commit -m "feat(auth): add email verification routes"
```

---

## Task 6: Verify Email Integration Flow

**Files:**
- Modify: `server/tests/test_auth_routes_int.py`

- [ ] **Step 1: Add integration test for verification success and bonus idempotency**

Append this test method to `AuthRoutesIntegrationTests`:

```python
    async def test_verify_email_grants_signup_bonus_once(self):
        email = self._track(_rand_email())
        reg = await self.client.post("/api/auth/register", json={"email": email, "password": "abc12345"})
        self.assertEqual(reg.status_code, 201, reg.text)
        uid = reg.json()["user"]["id"]

        factory = get_session_factory()
        async with factory() as s:
            from app.models import EmailVerificationToken
            row = (await s.execute(
                EmailVerificationToken.__table__.select().where(
                    EmailVerificationToken.user_id == uid
                )
            )).fetchone()
            self.assertIsNotNone(row)

        from app.email_verification_service import create_verification_token
        async with factory() as s:
            user = (await s.execute(User.__table__.select().where(User.id == uid))).fetchone()
            token = await create_verification_token(s, user)
            await s.commit()

        ok = await self.client.post("/api/auth/verify-email", json={"token": token})
        self.assertEqual(ok.status_code, 200, ok.text)
        self.assertEqual(ok.json()["user"]["credits"], 5)
        self.assertFalse(ok.json()["user"]["verification_required"])

        again = await self.client.post("/api/auth/verify-email", json={"token": token})
        self.assertEqual(again.status_code, 200, again.text)
        self.assertEqual(again.json()["user"]["credits"], 5)

        async with factory() as s:
            rows = (await s.execute(
                CreditTransaction.__table__.select().where(CreditTransaction.user_id == uid)
            )).fetchall()
            signup_rows = [r for r in rows if r.reason == "signup_bonus"]
            self.assertEqual(len(signup_rows), 1)
```

- [ ] **Step 2: Run the new integration test**

Run:

```powershell
cd server
python -m unittest tests.test_auth_routes_int.AuthRoutesIntegrationTests.test_verify_email_grants_signup_bonus_once
```

Expected: pass.

- [ ] **Step 3: Add resend anti-enumeration test**

Append:

```python
    async def test_resend_verification_does_not_reveal_email_state(self):
        missing = await self.client.post(
            "/api/auth/resend-verification",
            json={"email": _rand_email()},
        )
        self.assertEqual(missing.status_code, 200)
        self.assertEqual(missing.json(), {"ok": True})

        email = self._track(_rand_email())
        reg = await self.client.post("/api/auth/register", json={"email": email, "password": "abc12345"})
        self.assertEqual(reg.status_code, 201)
        unverified = await self.client.post(
            "/api/auth/resend-verification",
            json={"email": email},
        )
        self.assertEqual(unverified.status_code, 200)
        self.assertEqual(unverified.json(), {"ok": True})
```

- [ ] **Step 4: Run resend test**

Run:

```powershell
cd server
python -m unittest tests.test_auth_routes_int.AuthRoutesIntegrationTests.test_resend_verification_does_not_reveal_email_state
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add server/tests/test_auth_routes_int.py
git commit -m "test(auth): cover email verification flow"
```

---

## Task 7: Require Verified User For Image Routes

**Files:**
- Modify: `server/app/routers/images.py`
- Modify: `server/tests/test_auth_routes_int.py`

- [ ] **Step 1: Add route guard test for generate**

Append this test to `AuthRoutesIntegrationTests`:

```python
    async def test_unverified_user_cannot_generate(self):
        email = self._track(_rand_email())
        reg = await self.client.post("/api/auth/register", json={"email": email, "password": "abc12345"})
        token = reg.json()["access_token"]
        conv = await self.client.post(
            "/api/conversations",
            headers={"Authorization": f"Bearer {token}"},
            json={"title": "verify guard"},
        )
        self.assertEqual(conv.status_code, 201, conv.text)
        r = await self.client.post(
            f"/api/images/generate?conversation_id={conv.json()['id']}",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "prompt": "test",
                "model": "gpt-image-2",
                "size": "auto",
                "quality": "low",
                "n": 1,
                "background": "auto",
                "output_format": "png",
                "moderation": "auto",
            },
        )
        self.assertEqual(r.status_code, 403)
        body = r.json()
        self.assertEqual(body["detail"]["error"]["code"], "email_not_verified")
```

- [ ] **Step 2: Run guard test and confirm it fails**

Run:

```powershell
cd server
python -m unittest tests.test_auth_routes_int.AuthRoutesIntegrationTests.test_unverified_user_cannot_generate
```

Expected: route does not return `email_not_verified`.

- [ ] **Step 3: Add route guard**

In `server/app/routers/images.py`, import:

```python
from ..email_verification_service import require_verified_user
```

In `generate()`, after `_load_owned_conv()`:

```python
    require_verified_user(user)
```

In `edit()`, move the guard before reading multipart bytes. Place it immediately after docstring and before `api_size = size.replace("×", "x")`:

```python
    require_verified_user(user)
```

- [ ] **Step 4: Run guard test**

Run:

```powershell
cd server
python -m unittest tests.test_auth_routes_int.AuthRoutesIntegrationTests.test_unverified_user_cannot_generate
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add server/app/routers/images.py server/tests/test_auth_routes_int.py
git commit -m "feat(auth): require verified email for image routes"
```

---

## Task 8: Frontend Auth API And Context

**Files:**
- Modify: `client/src/api/auth.ts`
- Modify: `client/src/auth/AuthContext.tsx`
- Modify: `client/src/auth/AuthOverlay.tsx`

- [ ] **Step 1: Update auth API types and functions**

In `client/src/api/auth.ts`, add fields to `UserPublic`:

```ts
  email_verified_at: string | null;
  verification_required: boolean;
```

Add to `TokenResponse`:

```ts
  verification_email_sent: boolean;
```

Add functions:

```ts
export async function verifyEmail(token: string): Promise<UserPublic> {
  const res = await fetch("/api/auth/verify-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new AuthApiError(res.status, await parseErrorBody(res));
  const body = (await res.json()) as { ok: boolean; user: UserPublic };
  return body.user;
}

export async function resendVerification(email: string): Promise<void> {
  const res = await fetch("/api/auth/resend-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new AuthApiError(res.status, await parseErrorBody(res));
}
```

- [ ] **Step 2: Update auth context**

In `client/src/auth/AuthContext.tsx`, import `resendVerification` and `verifyEmail` as API functions:

```ts
  resendVerification as apiResendVerification,
  verifyEmail as apiVerifyEmail,
```

Extend `AuthState`:

```ts
  verificationEmailSent: boolean | null;
  verifyEmailToken: (token: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
```

Add state:

```ts
  const [verificationEmailSent, setVerificationEmailSent] = useState<boolean | null>(null);
```

In login, after `setUser(r.user)`:

```ts
    setVerificationEmailSent(null);
```

In register, after `setUser(r.user)`:

```ts
      setVerificationEmailSent(r.verification_email_sent);
```

Add callbacks:

```ts
  const verifyEmailToken = useCallback(async (token: string) => {
    const nextUser = await apiVerifyEmail(token);
    setUser(nextUser);
    setVerificationEmailSent(null);
    setStatus("authenticated");
  }, []);

  const resendVerificationEmail = useCallback(async () => {
    if (!user) return;
    await apiResendVerification(user.email);
    setVerificationEmailSent(true);
  }, [user]);
```

Include new fields in `value` and dependency array.

- [ ] **Step 3: Remove disabled-specific login copy**

In `client/src/auth/AuthOverlay.tsx`, remove this entry from `ERROR_TEXT`:

```ts
  account_disabled: "账号已停用，请联系管理员",
```

Add:

```ts
  email_not_verified: "请先验证邮箱",
```

- [ ] **Step 4: Run client build**

Run:

```powershell
cd client
npm run build
```

Expected: TypeScript build succeeds and Vite finishes production build.

- [ ] **Step 5: Commit**

Run:

```powershell
git add client/src/api/auth.ts client/src/auth/AuthContext.tsx client/src/auth/AuthOverlay.tsx
git commit -m "feat(auth): expose email verification client api"
```

---

## Task 9: Frontend Verification UX

**Files:**
- Modify: `client/src/auth/UserBadge.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/api/gptImage.ts`

- [ ] **Step 1: Add friendly error message for unverified image requests**

In `client/src/api/gptImage.ts`, in both `generateImages()` and `editImage()` error parsing, after reading `apiError`, add:

```ts
    if (apiError.code === "email_not_verified") {
      apiError.message = "请先验证邮箱后再生成图片";
    }
```

- [ ] **Step 2: Add verification status and resend in UserBadge**

In `client/src/auth/UserBadge.tsx`, change the hook:

```ts
  const { user, logout, resendVerificationEmail } = useAuth();
```

Add state:

```ts
  const [resending, setResending] = useState(false);
```

Inside the dropdown before the divider, add:

```tsx
          <div style={{ padding: "2px 10px 8px", color: user.verification_required ? "#F0FE2D" : "#7CE38B", fontSize: 11 }}>
            邮箱：{user.verification_required ? "待验证" : "已验证"}
          </div>
          {user.verification_required && (
            <button
              type="button"
              disabled={resending}
              onClick={async () => {
                setResending(true);
                try {
                  await resendVerificationEmail();
                } finally {
                  setResending(false);
                }
              }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                borderRadius: 6,
                background: "none",
                border: "none",
                color: "#F0FE2D",
                cursor: resending ? "wait" : "pointer",
                fontSize: 13,
              }}
            >
              {resending ? "发送中…" : "重发验证邮件"}
            </button>
          )}
```

- [ ] **Step 3: Block generate button for unverified users**

In `client/src/App.tsx`, update `canGenerate` to include:

```ts
    && !user?.verification_required
```

In `handleGenerate()`, after `if (!prompt || isGenerating) return;`, add:

```ts
    if (user?.verification_required) {
      setErrorMsg("请先验证邮箱后再生成图片");
      return;
    }
```

- [ ] **Step 4: Run client build**

Run:

```powershell
cd client
npm run build
```

Expected: TypeScript build succeeds and Vite finishes production build.

- [ ] **Step 5: Commit**

Run:

```powershell
git add client/src/api/gptImage.ts client/src/auth/UserBadge.tsx client/src/App.tsx
git commit -m "feat(auth): show email verification prompt"
```

---

## Task 10: Final Verification And Documentation Sync

**Files:**
- Modify: `.env.example` if it exists
- Modify: `docs/superpowers/specs/2026-05-20-auth-p2-email-verification-design.md` only if implementation discovers a contract mismatch

- [ ] **Step 1: Find environment sample file**

Run:

```powershell
rg --files -g ".env.example" -g "env.example" -g "*.env.example"
```

Expected: list of env sample files or no output.

- [ ] **Step 2: Update env sample if present**

If an env sample exists, add these keys with non-secret values:

```env
APP_ENV=development
JWT_EXP_HOURS=24
EMAIL_PROVIDER=console
EMAIL_FROM_ADDRESS=noreply@mail.example.com
EMAIL_FROM_ALIAS=image2
EMAIL_VERIFY_BASE_URL=http://127.0.0.1:5173/verify-email
EMAIL_VERIFY_TOKEN_TTL_HOURS=24
EMAIL_RESEND_COOLDOWN_SECONDS=60
EMAIL_VERIFY_DAILY_LIMIT=5
RATE_LIMIT_VERIFY_EMAIL=5/hour
RATE_LIMIT_RESEND_VERIFICATION=5/hour
ALIYUN_DIRECTMAIL_ACCESS_KEY_ID=
ALIYUN_DIRECTMAIL_ACCESS_KEY_SECRET=
ALIYUN_DIRECTMAIL_ACCOUNT_NAME=
ALIYUN_DIRECTMAIL_REGION=cn-hangzhou
```

- [ ] **Step 3: Run backend unit tests**

Run:

```powershell
cd server
python -m unittest tests.test_auth_service_unit tests.test_email_verification_service_unit
```

Expected: all tests pass.

- [ ] **Step 4: Run backend integration tests when env is configured**

Run:

```powershell
cd server
python -m unittest tests.test_auth_routes_int
```

Expected: tests pass when `DATABASE_URL`, `REDIS_URL`, and `JWT_SECRET` are configured; otherwise unittest reports the class skipped.

- [ ] **Step 5: Run frontend build**

Run:

```powershell
cd client
npm run build
```

Expected: `tsc -b` succeeds and Vite writes `dist`.

- [ ] **Step 6: Check git diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors. Status should only show files intentionally changed by this plan plus unrelated pre-existing `docs/email-templates/`.

- [ ] **Step 7: Commit final docs or env sample updates**

Run:

```powershell
git add .env.example docs/superpowers/specs/2026-05-20-auth-p2-email-verification-design.md
git commit -m "docs: sync auth p2 environment settings"
```

If neither file exists in the index after Step 2, skip this commit and record that no docs/env sync was needed.

---

## Self-Review Checklist

- Spec goal “注册后必须验证邮箱才允许 generate/edit”：Task 7 and Task 9 cover backend and frontend.
- Spec goal “signup bonus 验证成功后发放且只一次”：Task 4, Task 5, and Task 6 cover service, route, and integration test.
- Spec goal “token 明文不落库，只存 hash”：Task 2 and Task 4 cover model and hashing tests.
- Spec goal “重发验证不枚举邮箱”：Task 5 and Task 6 cover fixed `200 ok` response.
- Spec goal “disabled 登录不泄露状态”：Task 1 and Task 5 cover service and integration behavior.
- Spec goal “JWT 默认 24h”：Task 1 covers config and tests.
- Spec goal “provider 抽象，默认阿里云”：Task 3 covers provider layer and startup guard.
- Spec non-goals “不做 refresh token、不改 localStorage”：Task 8 and Task 9 keep existing token storage.
- Plan uses exact file paths, concrete commands, concrete expected outcomes, and task-level commits.
