"""模型广场 8 张封面素材一次性生成脚本。

直接调上游 OpenAI 兼容接口（OPENAI_BASE_URL/images/generations），
**强制使用 model=gpt-image-2**（不走后端的 UPSTREAM_MODEL_OVERRIDE 路由）。
存 PNG → 用 PIL 转 webp 控制体积 → 最终落到 client/src/assets/plaza/。

用法（项目根目录）：
    server\\.venv\\Scripts\\python.exe scripts\\gen_plaza_assets.py
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / "server" / ".env"
DEST = ROOT / "client" / "src" / "assets" / "plaza"
DEST.mkdir(parents=True, exist_ok=True)


def load_env(path: Path) -> dict[str, str]:
    """简单解析 KEY=VALUE 风格的 .env。"""
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


# 强制使用 gpt-image-2 模型（用户指令），不复用后端的 vip override
MODEL = "gpt-image-2"
SIZE = "1024x768"
QUALITY = "low"

# (slug, prompt) 数对。
ITEMS: list[tuple[str, str]] = [
    (
        "featured-gpt",
        "A cinematic deep purple nebula filling the frame, with subtle floating geometric crystal "
        "fragments and a hint of golden particles. Soft volumetric light from the upper right, "
        "mysterious sci-fi mood, sharp focus, ultra high detail. No text, no logos.",
    ),
    (
        "featured-banana",
        "Cinematic still life of a single perfectly ripe yellow banana resting on a dark wooden "
        "surface, dramatic warm orange rim light from the side, deep chocolate brown background, "
        "shallow depth of field, magazine food photography quality. No text.",
    ),
    (
        "featured-nano",
        "An emerald green futuristic racing car captured in motion blur, streaking past neon track "
        "lights, dark asphalt background, strong sense of speed, cinematic low angle, sharp highlights "
        "on the car body. No text, no logos.",
    ),
    (
        "featured-pro",
        "Studio portrait of an ancient Greek marble bust, dramatic pink-to-purple ambient gradient "
        "lighting from behind, soft fog atmosphere, museum-quality cinematic composition, ultra crisp "
        "marble texture. No text.",
    ),
    (
        "rec-vision",
        "Hyper-realistic portrait close-up of a stylish person against a deep navy gradient "
        "background, razor sharp eyes and skin pore detail, soft rim light, cinematic color grade. "
        "No text.",
    ),
    (
        "rec-dreamer",
        "Surreal dreamlike landscape: floating islands drifting above a soft purple gradient sky, "
        "wisps of cloud, distant magical glow, painterly magical realism, ultra wide cinematic. "
        "No text.",
    ),
    (
        "rec-chat",
        "Mysterious anthropomorphic AI head silhouette, glowing cyan internal light leaking through "
        "cracks of polished black material, dark cinematic background, futuristic conceptual portrait. "
        "No text.",
    ),
    (
        "rec-multi",
        "Creative collage poster blending typography fragments, photographic image scraps and audio "
        "waveforms into one composition, vibrant magenta-to-violet palette, layered paper textures, "
        "art-direction quality. No readable text labels.",
    ),
]


def call_upstream(prompt: str, *, base_url: str, api_key: str) -> bytes:
    """直接打上游 /images/generations，返回 PNG 字节流。"""
    endpoint = base_url.rstrip("/") + "/images/generations"
    payload = json.dumps(
        {
            "model": MODEL,
            "prompt": prompt,
            "size": SIZE,
            "quality": QUALITY,
            "n": 1,
            "output_format": "png",
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        body = json.loads(resp.read())
    data = (body.get("data") or [{}])[0]
    if data.get("b64_json"):
        return base64.b64decode(data["b64_json"])
    if data.get("url"):
        with urllib.request.urlopen(data["url"], timeout=120) as ir:
            return ir.read()
    raise RuntimeError(f"上游既无 b64_json 也无 url: {body}")


def png_to_webp(png_bytes: bytes, out_path: Path, quality: int) -> int:
    """PNG → webp，返回最终字节数。"""
    img = Image.open(BytesIO(png_bytes)).convert("RGB")
    img.save(out_path, "webp", quality=quality, method=6)
    return out_path.stat().st_size


def main() -> int:
    env = load_env(ENV_FILE)
    api_key = env.get("OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY", "")
    base_url = env.get("OPENAI_BASE_URL") or os.environ.get("OPENAI_BASE_URL", "")
    if not api_key or not base_url:
        print("[ERR] 缺少 OPENAI_API_KEY 或 OPENAI_BASE_URL（应位于 server/.env）")
        return 2

    print(f"[plaza] 模型: {MODEL}  尺寸: {SIZE}  质量: {QUALITY}")
    print(f"[plaza] 上游: {base_url}")
    print(f"[plaza] 输出: {DEST}")

    for idx, (slug, prompt) in enumerate(ITEMS, 1):
        out_path = DEST / f"{slug}.webp"
        if out_path.exists():
            print(f"[{idx}/{len(ITEMS)}] {slug}.webp 已存在，跳过")
            continue
        t0 = time.time()
        print(f"[{idx}/{len(ITEMS)}] 生成 {slug} ... ", end="", flush=True)
        try:
            png = call_upstream(prompt, base_url=base_url, api_key=api_key)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "ignore")
            print(f"FAIL HTTP {e.code}: {body[:300]}")
            return 1
        except Exception as e:
            print(f"FAIL {e}")
            return 1
        webp_q = 82 if slug.startswith("featured") else 78
        size = png_to_webp(png, out_path, webp_q)
        print(f"OK {size/1024:.1f}KB ({time.time()-t0:.1f}s)")
    print("[plaza] 全部完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
