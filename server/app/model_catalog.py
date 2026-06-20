"""前台可选择的生图模型目录与计费规则。"""
from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse


@dataclass(frozen=True)
class ImageModelDefinition:
    id: str
    label: str
    description: str
    cost_per_image: int
    upstream_model: str
    provider_model: str | None = None
    supports_edit: bool = False
    supports_reasoning: bool = False
    accent: str = "#D7FF00"


IMAGE_MODEL_DEFINITIONS: tuple[ImageModelDefinition, ...] = (
    ImageModelDefinition(
        id="image2",
        label="Image2",
        description="统一生图模型，支持文生图、图生图和高级控制。",
        cost_per_image=4,
        upstream_model="gpt-image-2",
        supports_edit=True,
        supports_reasoning=True,
        accent="#D7FF00",
    ),
    ImageModelDefinition(
        id="gemini",
        label="Gemini Flash Image",
        description="轻量图像生成模型，适合低成本快速出图。",
        cost_per_image=2,
        upstream_model="gemini-2.5-flash-image",
        accent="#7CE38B",
    ),
    ImageModelDefinition(
        id="cloudflare",
        label="FLUX Schnell",
        description="快速文生图模型，适合概念草稿和低成本批量尝试。",
        cost_per_image=1,
        upstream_model="cloudflare-flux-schnell",
        accent="#4CB1FF",
    ),
    ImageModelDefinition(
        id="huggingface",
        label="FLUX Dev",
        description="开源风格生图模型，适合稳定风格探索。",
        cost_per_image=1,
        upstream_model="huggingface-flux-dev",
        accent="#FFB86B",
    ),
    ImageModelDefinition(
        id="pollinations",
        label="FLUX Lite",
        description="轻量文生图模型，适合快速尝试和草图预览。",
        cost_per_image=1,
        upstream_model="pollinations-flux",
        provider_model="flux",
        accent="#FF7E87",
    ),
)

IMAGE_MODELS_BY_ID = {item.id: item for item in IMAGE_MODEL_DEFINITIONS}

IMAGE_MODEL_ALIASES = {
    "gpt-image-2": "image2",
    "image2": "image2",
    "gemini": "gemini",
    "gemini-2.5-flash-image": "gemini",
    "cloudflare": "cloudflare",
    "cloudflare-flux": "cloudflare",
    "cloudflare-flux-schnell": "cloudflare",
    "huggingface": "huggingface",
    "hf": "huggingface",
    "hf-flux": "huggingface",
    "huggingface-flux": "huggingface",
    "huggingface-flux-dev": "huggingface",
    "pollinations": "pollinations",
    "pollinations-flux": "pollinations",
}


def normalize_image_model_id(value: str | None) -> str:
    key = (value or "image2").strip().lower()
    if key in IMAGE_MODEL_ALIASES:
        return IMAGE_MODEL_ALIASES[key]
    raise ValueError(f"不支持的生图模型：{value}")


def get_image_model(value: str | None) -> ImageModelDefinition:
    return IMAGE_MODELS_BY_ID[normalize_image_model_id(value)]


def calculate_image_model_cost(model: str | None, n: int) -> int:
    definition = get_image_model(model)
    return definition.cost_per_image * max(1, int(n or 1))


def image_model_matches_base_url(model: str | None, base_url: str) -> bool:
    model_id = normalize_image_model_id(model)
    host = (urlparse(base_url).hostname or "").lower()
    path = urlparse(base_url).path.lower()
    if model_id == "image2":
        return (
            host == "feiyuai.icu"
            or host.endswith(".feiyuai.icu")
            or host == "api2.tabcode.cc"
            or host.endswith(".tabcode.cc")
        )
    if model_id == "gemini":
        return host == "generativelanguage.googleapis.com"
    if model_id == "cloudflare":
        return host == "api.cloudflare.com"
    if model_id == "huggingface":
        return host == "router.huggingface.co" and path.strip("/").startswith("fal-ai/")
    if model_id == "pollinations":
        return host in {
            "image.pollinations.ai",
            "gen.pollinations.ai",
            "pollinations.ai",
            "www.pollinations.ai",
        }
    return False
