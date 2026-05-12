"""从 .env 加载配置；统一配置入口"""
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
        # 中转商若用变体模型名，可在此覆盖；留空时透传前端值
        self.upstream_model_override: str = os.getenv("UPSTREAM_MODEL_OVERRIDE", "").strip()
        # 4K 边长请求时使用的变体；留空则复用 override
        self.upstream_model_override_4k: str = os.getenv(
            "UPSTREAM_MODEL_OVERRIDE_4K", ""
        ).strip() or self.upstream_model_override
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

        if not self.openai_api_key:
            # 不直接 raise，让健康检查仍可访问；调用时再报错
            pass


@lru_cache
def get_settings() -> Settings:
    return Settings()
