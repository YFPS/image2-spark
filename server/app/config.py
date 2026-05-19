"""从 .env 加载配置；统一配置入口"""
# 触发 reload pick up .env 改动 v2
from __future__ import annotations

import os
from functools import lru_cache

from dotenv import load_dotenv

# 加载 server/.env
load_dotenv()


class Settings:
    """运行时配置"""

    def __init__(self) -> None:
        self.openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
        self.openai_base_url: str = os.getenv(
            "OPENAI_BASE_URL", "https://api.openai.com/v1"
        ).rstrip("/")
        self.openai_timeout: float = float(os.getenv("OPENAI_TIMEOUT", "120"))
        # 抠图模型（rembg，仅 SEGMENT_BACKEND=rembg 时生效）
        self.rembg_model: str = os.getenv("REMBG_MODEL", "u2netp").strip() or "u2netp"
        # 抠图后端：grabcut（默认，复杂海报场景表现好）/ rembg（v1，简单贴纸场景）
        self.segment_backend: str = (
            os.getenv("SEGMENT_BACKEND", "grabcut").strip().lower() or "grabcut"
        )
        self.sam_checkpoint: str = os.getenv("SAM_CHECKPOINT", "").strip()
        self.sam_model_type: str = os.getenv("SAM_MODEL_TYPE", "vit_b").strip() or "vit_b"
        self.sam_device: str = os.getenv("SAM_DEVICE", "auto").strip().lower() or "auto"
        # MobileSAM 后端（SEGMENT_BACKEND=mobile_sam 时生效）
        # 默认权重路径相对仓库根：server/models/mobile_sam/mobile_sam.pt
        default_mobile_ckpt = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "models", "mobile_sam", "mobile_sam.pt",
        )
        self.mobile_sam_checkpoint: str = (
            os.getenv("MOBILE_SAM_CHECKPOINT", "").strip() or default_mobile_ckpt
        )
        self.mobile_sam_device: str = (
            os.getenv("MOBILE_SAM_DEVICE", "auto").strip().lower() or "auto"
        )

        # ===== auth-foundation =====
        # MySQL 异步连接串：mysql+asyncmy://user:pass@host:3306/image2?charset=utf8mb4
        self.database_url: str = os.getenv("DATABASE_URL", "").strip()
        # Redis 连接串：redis://host:port/db
        self.redis_url: str = os.getenv("REDIS_URL", "").strip()
        # JWT 签名密钥（HS256），必填，建议 64 字符以上随机串
        self.jwt_secret: str = os.getenv("JWT_SECRET", "").strip()
        self.jwt_exp_days: int = int(os.getenv("JWT_EXP_DAYS", "7"))
        self.bcrypt_rounds: int = int(os.getenv("BCRYPT_ROUNDS", "12"))
        # 新用户注册赠送积分（1 积分 ≈ 1 张普通生图，扣费规则下期定）
        self.signup_bonus_credits: int = int(os.getenv("SIGNUP_BONUS_CREDITS", "5"))
        # 登录失败限流
        self.login_fail_max: int = int(os.getenv("LOGIN_FAIL_MAX", "5"))
        self.login_fail_window: int = int(os.getenv("LOGIN_FAIL_WINDOW", "300"))
        self.login_lock_ttl: int = int(os.getenv("LOGIN_LOCK_TTL", "900"))

        # ===== P1 安全加固：proxy-image host allowlist =====
        # 逗号分隔的 host 列表，proxy-image 只允许反代这些 host 上的资源
        # 留空 = 关闭白名单（仅做开发环境兜底，生产必须配）
        raw_allow = os.getenv("PROXY_IMAGE_HOST_ALLOWLIST", "").strip()
        self.proxy_image_host_allowlist: tuple[str, ...] = tuple(
            h.strip().lower() for h in raw_allow.split(",") if h.strip()
        )

        # ===== P1 安全加固：全局与端点级限流 =====
        # 全局：按 IP 每分钟最多 N 次，挡爬虫与脚本扫
        self.rate_limit_global: str = os.getenv("RATE_LIMIT_GLOBAL", "120/minute")
        # 生图/改图：按用户 id 限频，挡已登录用户烧 API key
        self.rate_limit_generate: str = os.getenv("RATE_LIMIT_GENERATE", "6/minute")
        # 抠图 ML 推理：CPU 密集，限严点
        self.rate_limit_segment: str = os.getenv("RATE_LIMIT_SEGMENT", "12/minute")
        # 注册：按 IP，防批量造号
        self.rate_limit_register: str = os.getenv("RATE_LIMIT_REGISTER", "3/hour")

        # 上传字节硬限（10 MB），edit / brush-cutout 单文件不可超
        self.upload_max_bytes: int = int(os.getenv("UPLOAD_MAX_BYTES", str(10 * 1024 * 1024)))

        if not self.openai_api_key:
            # 不直接 raise，让健康检查仍可访问；调用时再报错
            pass


@lru_cache
def get_settings() -> Settings:
    return Settings()
