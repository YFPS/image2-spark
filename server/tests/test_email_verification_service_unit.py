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


if __name__ == "__main__":
    unittest.main()
