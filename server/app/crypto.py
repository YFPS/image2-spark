"""API Key 加解密工具

使用 Fernet 对称加密（AES-128-CBC + HMAC-SHA256）。
密钥从环境变量 API_KEY_ENCRYPTION_KEY 读取，32 字符 base64 编码。
"""
from __future__ import annotations

import base64
import logging
import os

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    """获取 Fernet 实例（懒加载单例）"""
    global _fernet
    if _fernet is not None:
        return _fernet
    key = os.getenv("API_KEY_ENCRYPTION_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "API_KEY_ENCRYPTION_KEY 未配置。"
            "请运行 python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\" 生成密钥。"
        )
    # 兼容：如果用户直接贴了原始 32 字符密钥而非 base64，自动编码
    if len(key) == 32 and not key.endswith("="):
        key = base64.urlsafe_b64encode(key.encode()).decode()
    _fernet = Fernet(key.encode())
    return _fernet


def encrypt_api_key(plain: str) -> str:
    """加密 api_key，返回 fernet token 字符串"""
    f = _get_fernet()
    return f.encrypt(plain.encode()).decode()


def decrypt_api_key(encrypted: str) -> str:
    """解密 api_key。如果解密失败（可能是明文旧数据），原样返回。"""
    try:
        f = _get_fernet()
        return f.decrypt(encrypted.encode()).decode()
    except (InvalidToken, Exception):
        # 向后兼容：旧数据是明文，解密失败时原样返回
        logger.debug("api_key 解密失败，视为明文旧数据原样返回")
        return encrypted


def is_encrypted(value: str) -> bool:
    """判断值是否是 Fernet 加密格式（以 gAAAAA 开头）"""
    return value.startswith("gAAAAA")


def is_encryption_configured() -> bool:
    """检查 API_KEY_ENCRYPTION_KEY 是否已配置"""
    return bool(os.getenv("API_KEY_ENCRYPTION_KEY", "").strip())
