"""auth_service 纯函数单测（不依赖 DB / Redis）"""
from __future__ import annotations

import os
import unittest
from datetime import datetime, timedelta, timezone

# 单测在 import app.config 前注入最少 env，避免 lru_cache 误锁默认值
os.environ.setdefault("JWT_SECRET", "x" * 64)

import jwt  # noqa: E402

from app.auth_service import (  # noqa: E402
    create_jwt,
    decode_jwt,
    hash_password,
    normalize_email,
    verify_password,
)
from app.config import get_settings  # noqa: E402
from app.schemas import RegisterRequest  # noqa: E402


class PasswordHashTests(unittest.TestCase):
    def test_hash_verify_roundtrip(self):
        h = hash_password("Hunter2_strong")
        self.assertNotEqual(h, "Hunter2_strong")
        self.assertTrue(verify_password("Hunter2_strong", h))

    def test_wrong_password_rejected(self):
        h = hash_password("Hunter2_strong")
        self.assertFalse(verify_password("wrong-pw-123", h))

    def test_malformed_hash_returns_false(self):
        self.assertFalse(verify_password("any", "not-a-bcrypt-hash"))


class JwtTests(unittest.TestCase):
    def test_jwt_roundtrip(self):
        token, exp_in, jti = create_jwt(user_id=42, email="a@b.com", role="user")
        self.assertGreater(exp_in, 0)
        payload = decode_jwt(token)
        self.assertEqual(payload["sub"], "42")
        self.assertEqual(payload["email"], "a@b.com")
        self.assertEqual(payload["role"], "user")
        self.assertEqual(payload["jti"], jti)

    def test_jwt_jti_unique_per_signing(self):
        _, _, jti_a = create_jwt(user_id=1, email="a@b.com", role="user")
        _, _, jti_b = create_jwt(user_id=1, email="a@b.com", role="user")
        self.assertNotEqual(jti_a, jti_b)

    def test_expired_jwt_rejected(self):
        # 手工签发一个过期 token
        secret = get_settings().jwt_secret
        past = datetime.now(tz=timezone.utc) - timedelta(hours=1)
        token = jwt.encode(
            {"sub": "1", "email": "a@b.com", "role": "user", "jti": "x",
             "iat": int(past.timestamp()) - 10,
             "exp": int(past.timestamp())},
            secret,
            algorithm="HS256",
        )
        with self.assertRaises(jwt.ExpiredSignatureError):
            decode_jwt(token)

    def test_bad_signature_rejected(self):
        token, _, _ = create_jwt(user_id=1, email="a@b.com", role="user")
        # 截断签名
        bad = token[:-4] + "AAAA"
        with self.assertRaises(jwt.PyJWTError):
            decode_jwt(bad)


class PasswordPolicyTests(unittest.TestCase):
    def test_password_too_short(self):
        with self.assertRaises(Exception):
            RegisterRequest(email="a@b.com", password="ab12")

    def test_password_missing_digit(self):
        with self.assertRaises(Exception):
            RegisterRequest(email="a@b.com", password="onlyletters")

    def test_password_missing_letter(self):
        with self.assertRaises(Exception):
            RegisterRequest(email="a@b.com", password="123456789")

    def test_password_too_long(self):
        with self.assertRaises(Exception):
            RegisterRequest(email="a@b.com", password="a1" + "x" * 80)

    def test_password_ok(self):
        req = RegisterRequest(email="a@b.com", password="abc12345")
        self.assertEqual(req.password, "abc12345")


class EmailNormalizationTests(unittest.TestCase):
    def test_lower_and_strip(self):
        self.assertEqual(normalize_email("  Foo@BAR.com "), "foo@bar.com")

    def test_invalid_email_caught_by_schema(self):
        with self.assertRaises(Exception):
            RegisterRequest(email="not-an-email", password="abc12345")


class JwtTtlConfigTests(unittest.TestCase):
    """JWT 有效期按小时配置；JWT_EXP_DAYS 为兼容旧 env 的回退。"""

    def setUp(self):
        get_settings.cache_clear()
        os.environ["JWT_SECRET"] = "x" * 64

    def tearDown(self):
        os.environ.pop("JWT_EXP_HOURS", None)
        # 保留默认 JWT_EXP_DAYS，避免影响后续单测
        get_settings.cache_clear()

    def test_jwt_exp_hours_controls_expires_in(self):
        os.environ["JWT_EXP_HOURS"] = "24"
        get_settings.cache_clear()
        token, exp_in, _jti = create_jwt(user_id=9, email="ttl@example.com", role="user")
        payload = decode_jwt(token)
        self.assertEqual(payload["sub"], "9")
        # 24h ≈ 86400s，允许 ±10s
        self.assertGreaterEqual(exp_in, 86_390)
        self.assertLessEqual(exp_in, 86_400)

    def test_legacy_jwt_exp_days_is_still_read_when_hours_missing(self):
        os.environ.pop("JWT_EXP_HOURS", None)
        os.environ["JWT_EXP_DAYS"] = "2"
        get_settings.cache_clear()
        _token, exp_in, _jti = create_jwt(user_id=9, email="ttl@example.com", role="user")
        # 2 天 = 172800s
        self.assertGreaterEqual(exp_in, 172_790)
        self.assertLessEqual(exp_in, 172_800)


if __name__ == "__main__":
    unittest.main()
