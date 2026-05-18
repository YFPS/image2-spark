"""为模型广场 8 个模型批量生成宣传海报。

复用 server 的 OPENAI_API_KEY / OPENAI_BASE_URL 配置，直接调上游 /images/generations，
绕过 conversation 任务化流程。

用法（在 server/ 目录下）：
    .venv\\Scripts\\activate
    python -m scripts.gen_plaza_posters

输出：
    client/src/assets/plaza/featured-{id}.webp  ×4
    client/src/assets/plaza/rec-{id}.webp        ×4

尺寸：1280×720（16:9，单边 ≤ 3840，总像素 921,600，宽高比合规），让 CSS object-cover 适配卡片。
质量：low（海报缩略图够用，成本低）。
格式：webp（比 png 小一半，浏览器原生支持）。
"""
from __future__ import annotations

import asyncio
import base64
import sys
from pathlib import Path

# 把 server/ 加入 sys.path，便于以 `python -m scripts.xxx` 形式跑
SERVER_DIR = Path(__file__).resolve().parent.parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from app.openai_client import call_images_generate, UpstreamError, UpstreamTimeout  # noqa: E402

# 输出目录：仓库根 / client/src/assets/plaza
REPO_ROOT = SERVER_DIR.parent
OUT_DIR = REPO_ROOT / "client" / "src" / "assets" / "plaza"

# 8 个模型海报 prompt：风格沿用 data.ts 中各模型的视觉调性
# (filename, prompt)
POSTERS: list[tuple[str, str]] = [
    # ===== 4 旗舰卡 =====
    (
        "featured-gpt-image2.webp",
        "Cinematic poster, deep cosmic purple nebula with floating geometric polyhedrons and "
        "crystalline shapes, a single ray of bright violet light cutting through center, "
        "mystical high-tech atmosphere, ultra detailed, octane render, dark background, no text",
    ),
    (
        "featured-banana.webp",
        "Cinematic still life poster, three ripe golden yellow bananas arranged on a deep "
        "warm orange background, dramatic side lighting, soft shadows, retro film photography, "
        "rich color grading, editorial style, no text",
    ),
    (
        "featured-nano.webp",
        "Cinematic poster, an emerald green futuristic race car streaking through a dark tunnel, "
        "motion blur trail, neon green underglow, speed lines, minimalist composition, "
        "dynamic angle, no text",
    ),
    (
        "featured-pro.webp",
        "Cinematic poster, classical Greek marble statue bust in three-quarter view, soft pink "
        "and violet rim lighting against deep purple background, fine marble texture, "
        "museum atmosphere, dramatic chiaroscuro, no text",
    ),
    # ===== 4 推荐卡 =====
    (
        "rec-vision-xl.webp",
        "Cinematic poster, ultra-detailed close-up portrait of a young person looking up at "
        "a futuristic skyline at dusk, cool blue and teal tones, sharp focus, photorealistic, "
        "shallow depth of field, no text",
    ),
    (
        "rec-dreamer.webp",
        "Surreal dream poster, mystical violet enchanted forest with floating glowing butterflies "
        "and ethereal purple mist, soft dreamy lighting, painterly fantasy style, "
        "magical atmosphere, no text",
    ),
    (
        "rec-chat-master.webp",
        "Abstract poster, flowing wave-like neural network lines and connection nodes, "
        "deep teal and cyan glow on dark background, futuristic data stream, minimalist, "
        "high contrast, no text",
    ),
    (
        "rec-multi-modal.webp",
        "Poster of a vibrant collage mixing text characters, geometric shapes, sound wave "
        "patterns and abstract paint splashes, pink violet rose neon palette, "
        "maximalist composition, dark background, no text",
    ),
]

# 上游生图参数
GEN_PARAMS = {
    "model": "gpt-image-2",
    "size": "1280x720",
    "quality": "low",
    "n": 1,
    "background": "auto",
    "output_format": "webp",
    "moderation": "auto",
}


async def generate_one(filename: str, prompt: str) -> bytes | None:
    """生成一张海报；返回 webp 字节，失败返回 None。"""
    payload = {**GEN_PARAMS, "prompt": prompt}
    try:
        resp = await call_images_generate(payload)
    except UpstreamTimeout as e:
        print(f"[err ] timeout {filename}: {e}")
        return None
    except UpstreamError as e:
        print(f"[err ] upstream {e.status} {filename}: {e}")
        return None
    except Exception as e:  # noqa: BLE001
        print(f"[err ] exception {filename}: {e!r}")
        return None

    images = resp.get("data") or resp.get("images") or []
    if not images:
        print(f"[err ] empty data {filename}: {resp!r}")
        return None
    first = images[0]
    b64 = first.get("b64_json")
    if b64:
        return base64.b64decode(b64)
    url = first.get("url")
    if url:
        # 通过 httpx 拉取
        import httpx
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.get(url)
            r.raise_for_status()
            return r.content
    print(f"[err ] no b64_json or url {filename}: {first!r}")
    return None


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[out] {OUT_DIR}")
    print(f"[cfg] size={GEN_PARAMS['size']} quality={GEN_PARAMS['quality']} "
          f"format={GEN_PARAMS['output_format']} total={len(POSTERS)}")

    ok = 0
    for filename, prompt in POSTERS:
        out_path = OUT_DIR / filename
        if out_path.exists():
            print(f"[skip] {filename} ({out_path.stat().st_size // 1024} KB exists)")
            ok += 1
            continue
        print(f"[gen ] {filename} ...")
        data = await generate_one(filename, prompt)
        if data is None:
            continue
        out_path.write_bytes(data)
        print(f"[ok  ] {filename} ({len(data) // 1024} KB saved)")
        ok += 1

    print(f"\n[done] {ok}/{len(POSTERS)}")
    return 0 if ok == len(POSTERS) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
