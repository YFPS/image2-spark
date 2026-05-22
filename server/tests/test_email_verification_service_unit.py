"""邮箱验证服务单测（纯函数 + Provider 抽象）"""
from __future__ import annotations

import os
import unittest

# 单测在 import app.config 前注入最少 env，避免 lru_cache 误锁默认值
os.environ.setdefault("JWT_SECRET", "x" * 64)


class EmailVerificationModelTests(unittest.TestCase):
    """ORM 模型 smoke：保证模型列与表名定义符合设计文档。"""

    def test_user_has_verification_columns(self):
        from app.models import User
        self.assertIn("email_verified_at", User.__table__.columns)
        self.assertIn("signup_bonus_granted_at", User.__table__.columns)

    def test_token_model_has_hash_and_expiry_columns(self):
        from app.models import EmailVerificationToken
        self.assertEqual(EmailVerificationToken.__tablename__, "email_verification_tokens")
        self.assertIn("token_hash", EmailVerificationToken.__table__.columns)
        self.assertIn("expires_at", EmailVerificationToken.__table__.columns)
        self.assertIn("used_at", EmailVerificationToken.__table__.columns)


class EmailProviderTests(unittest.TestCase):
    """provider 工厂与 console/null 实现的最小验证。"""

    def setUp(self):
        from app.config import get_settings
        get_settings.cache_clear()

    def tearDown(self):
        from app.config import get_settings
        os.environ.pop("EMAIL_PROVIDER", None)
        get_settings.cache_clear()

    def test_null_provider_records_no_messages(self):
        import asyncio
        from app.email_provider import NullEmailProvider

        async def _run():
            provider = NullEmailProvider()
            await provider.send_verification_email(
                to_email="user@example.com",
                nickname="User",
                verify_url="https://example.com/verify-email?token=abc",
                expires_hours=24,
            )
            self.assertEqual(provider.sent_count, 1)
            self.assertEqual(provider.sent[0]["to_email"], "user@example.com")

        asyncio.run(_run())

    def test_get_provider_uses_console_by_default(self):
        from app.config import get_settings
        from app.email_provider import ConsoleEmailProvider, get_email_provider

        os.environ["EMAIL_PROVIDER"] = "console"
        get_settings.cache_clear()
        self.assertIsInstance(get_email_provider(), ConsoleEmailProvider)

    def test_get_provider_returns_smtp_when_configured(self):
        from app.config import get_settings
        from app.email_provider import SmtpEmailProvider, get_email_provider

        os.environ["EMAIL_PROVIDER"] = "smtp"
        get_settings.cache_clear()
        try:
            self.assertIsInstance(get_email_provider(), SmtpEmailProvider)
        finally:
            os.environ.pop("EMAIL_PROVIDER", None)
            get_settings.cache_clear()


class EmailVerificationPureFunctionTests(unittest.TestCase):
    """email_verification_service 中纯函数（hash/url）行为。"""

    def test_hash_verification_token_is_sha256_hex(self):
        from app.email_verification_service import hash_verification_token

        # 已知值：sha256('abc') = ba7816bf...
        self.assertEqual(
            hash_verification_token("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        )

    def test_build_verify_url_adds_token_query(self):
        from app.email_verification_service import build_verify_url

        self.assertEqual(
            build_verify_url("https://example.com/verify-email", "abc123"),
            "https://example.com/verify-email?token=abc123",
        )

    def test_build_verify_url_appends_when_query_exists(self):
        from app.email_verification_service import build_verify_url

        self.assertEqual(
            build_verify_url("https://example.com/v?lang=zh", "abc"),
            "https://example.com/v?lang=zh&token=abc",
        )

    def test_require_verified_user_blocks_unverified(self):
        from fastapi import HTTPException
        from app.email_verification_service import require_verified_user

        class _U:
            email_verified_at = None

        with self.assertRaises(HTTPException) as ctx:
            require_verified_user(_U())  # type: ignore[arg-type]
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(ctx.exception.detail["error"]["code"], "email_not_verified")

    def test_require_verified_user_passes_when_verified(self):
        from datetime import datetime, timezone

        from app.email_verification_service import require_verified_user

        class _U:
            email_verified_at = datetime.now(tz=timezone.utc).replace(tzinfo=None)

        # 不抛即视为通过
        require_verified_user(_U())  # type: ignore[arg-type]


if __name__ == "__main__":
    unittest.main()
