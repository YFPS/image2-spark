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
        # 备用上游：两项都非空才启用回退
        self.openai_api_key_backup: str = os.getenv("OPENAI_API_KEY_BACKUP", "").strip()
        self.openai_base_url_backup: str = os.getenv(
            "OPENAI_BASE_URL_BACKUP", ""
        ).strip().rstrip("/")
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
        # 运行环境：development / production；生产时启动校验更严
        self.app_env: str = os.getenv("APP_ENV", "development").strip().lower() or "development"
        # MySQL 异步连接串：mysql+asyncmy://user:pass@host:3306/image2?charset=utf8mb4
        self.database_url: str = os.getenv("DATABASE_URL", "").strip()
        # Redis 连接串：redis://host:port/db
        self.redis_url: str = os.getenv("REDIS_URL", "").strip()
        # JWT 签名密钥（HS256），必填，建议 64 字符以上随机串
        self.jwt_secret: str = os.getenv("JWT_SECRET", "").strip()
        # JWT 默认有效期：优先 JWT_EXP_HOURS（小时），回退 JWT_EXP_DAYS（天）以兼容旧 env
        raw_jwt_hours = os.getenv("JWT_EXP_HOURS")
        if raw_jwt_hours is not None and raw_jwt_hours.strip():
            self.jwt_exp_hours: int = int(raw_jwt_hours)
        else:
            self.jwt_exp_hours = int(os.getenv("JWT_EXP_DAYS", "1")) * 24
        # 旧代码可能仍读 jwt_exp_days，按小时回推一个粗略天数，避免崩
        self.jwt_exp_days: int = max(1, self.jwt_exp_hours // 24)
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
        # 图片代理只服务 UI 预览，源站慢时要快速失败，避免拖住页面其它接口观感
        self.proxy_image_timeout: float = float(os.getenv("PROXY_IMAGE_TIMEOUT", "6"))
        default_generated_dir = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "uploads",
            "generated",
        )
        self.generated_image_dir: str = (
            os.getenv("GENERATED_IMAGE_DIR", "").strip() or default_generated_dir
        )
        self.generated_image_cache_timeout: float = float(
            os.getenv("GENERATED_IMAGE_CACHE_TIMEOUT", "15")
        )
        # 历史出图源如果已经下线，不再返回给前端尝试加载，避免页面反复显示坏图。
        raw_dead_hosts = os.getenv("BROKEN_IMAGE_HOSTS", "67.21.86.146:3015").strip()
        self.broken_image_hosts: tuple[str, ...] = tuple(
            h.strip().lower() for h in raw_dead_hosts.split(",") if h.strip()
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

        # ===== 邮箱验证 / 邮件 provider（auth P2） =====
        # provider 选择：smtp（QQ/腾讯 SMTP，生产默认）/ console（开发期写日志）/ null（测试用）
        self.email_provider: str = (
            os.getenv("EMAIL_PROVIDER", "console").strip().lower() or "console"
        )
        # 邮件发件人显示信息
        self.email_from_address: str = os.getenv("EMAIL_FROM_ADDRESS", "").strip()
        self.email_from_alias: str = (
            os.getenv("EMAIL_FROM_ALIAS", "image2").strip() or "image2"
        )
        # 邮件中验证链接的 base URL（前端验证页）
        self.email_verify_base_url: str = os.getenv(
            "EMAIL_VERIFY_BASE_URL", "http://127.0.0.1:5173/verify-email"
        ).strip()
        self.email_verify_token_ttl_hours: int = int(
            os.getenv("EMAIL_VERIFY_TOKEN_TTL_HOURS", "24")
        )
        self.email_resend_cooldown_seconds: int = int(
            os.getenv("EMAIL_RESEND_COOLDOWN_SECONDS", "60")
        )
        self.email_verify_daily_limit: int = int(
            os.getenv("EMAIL_VERIFY_DAILY_LIMIT", "5")
        )
        self.rate_limit_verify_email: str = os.getenv("RATE_LIMIT_VERIFY_EMAIL", "5/hour")
        self.rate_limit_resend_verification: str = os.getenv(
            "RATE_LIMIT_RESEND_VERIFICATION", "5/hour"
        )

        # ===== SMTP provider 配置（QQ 邮箱 / 腾讯企业邮）=====
        # SMTP_USE_SSL=true 时走 465 SSL，否则走 STARTTLS
        self.smtp_host: str = os.getenv("SMTP_HOST", "smtp.qq.com").strip() or "smtp.qq.com"
        self.smtp_port: int = int(os.getenv("SMTP_PORT", "465"))
        self.smtp_use_ssl: bool = os.getenv("SMTP_USE_SSL", "true").strip().lower() in {
            "1", "true", "yes", "on",
        }
        self.smtp_user: str = os.getenv("SMTP_USER", "").strip()
        # QQ 邮箱 SMTP 必须用授权码，不是 QQ 密码
        self.smtp_pass: str = os.getenv("SMTP_PASS", "")
        # 不配置时 fallback 用 SMTP_USER 作为发件人
        self.smtp_from: str = os.getenv("SMTP_FROM", "").strip() or self.smtp_user
        self.smtp_from_name: str = (
            os.getenv("SMTP_FROM_NAME", "").strip() or self.email_from_alias
        )

        if not self.openai_api_key:
            # 不直接 raise，让健康检查仍可访问；调用时再报错
            pass


@lru_cache
def get_settings() -> Settings:
    return Settings()
