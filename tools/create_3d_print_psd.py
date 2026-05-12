from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

from tools.psd_writer import Layer, write_psd


ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r"C:\Users\ee960\Desktop\36b00f2a9cfa4aa5b3feddaa3a675f75.png")
OUT_DIR = ROOT / "outputs" / "3d_print_service_layers"
PSD_OUT = ROOT / "outputs" / "3d_print_service_layered.psd"
PREVIEW_OUT = ROOT / "outputs" / "3d_print_service_layered_preview.png"


@dataclass(frozen=True)
class LayerSpec:
    name: str
    filename: str
    alpha: np.ndarray


def _rect_mask(size: tuple[int, int], rect: tuple[int, int, int, int], radius: int = 0) -> np.ndarray:
    w, h = size
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    if radius > 0:
        draw.rounded_rectangle(rect, radius=radius, fill=255)
    else:
        draw.rectangle(rect, fill=255)
    return np.array(mask, dtype=np.uint8)


def _soften(mask: np.ndarray, blur: int = 3) -> np.ndarray:
    if blur <= 0:
        return mask.astype(np.uint8)
    k = blur if blur % 2 else blur + 1
    return cv2.GaussianBlur(mask.astype(np.uint8), (k, k), 0)


def _dark_mask(rgb: np.ndarray, rect: tuple[int, int, int, int], threshold: int = 150) -> np.ndarray:
    x0, y0, x1, y1 = rect
    crop = rgb[y0:y1, x0:x1].astype(np.int16)
    lum = (0.299 * crop[:, :, 0] + 0.587 * crop[:, :, 1] + 0.114 * crop[:, :, 2]).astype(np.int16)
    alpha = np.clip((threshold - lum) * 3, 0, 255).astype(np.uint8)
    alpha = cv2.morphologyEx(alpha, cv2.MORPH_CLOSE, np.ones((2, 2), np.uint8))
    out = np.zeros(rgb.shape[:2], dtype=np.uint8)
    out[y0:y1, x0:x1] = _soften(alpha, 3)
    return out


def _yellow_mask(rgb: np.ndarray, rect: tuple[int, int, int, int]) -> np.ndarray:
    x0, y0, x1, y1 = rect
    crop = rgb[y0:y1, x0:x1].astype(np.int16)
    r, g, b = crop[:, :, 0], crop[:, :, 1], crop[:, :, 2]
    raw = (r > 170) & (g > 120) & (b < 115) & ((r - b) > 90)
    alpha = raw.astype(np.uint8) * 255
    alpha = cv2.morphologyEx(alpha, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    out = np.zeros(rgb.shape[:2], dtype=np.uint8)
    out[y0:y1, x0:x1] = _soften(alpha, 3)
    return out


def _dark_or_yellow_mask(
    rgb: np.ndarray,
    rect: tuple[int, int, int, int],
    dark_threshold: int = 150,
) -> np.ndarray:
    dark = _dark_mask(rgb, rect, dark_threshold)
    yellow = _yellow_mask(rgb, rect)
    return np.maximum(dark, yellow)


def _printer_mask(rgb: np.ndarray, rect: tuple[int, int, int, int]) -> np.ndarray:
    x0, y0, x1, y1 = rect
    crop = rgb[y0:y1, x0:x1].astype(np.int16)
    hsv = cv2.cvtColor(crop.astype(np.uint8), cv2.COLOR_RGB2HSV)
    r, g, b = crop[:, :, 0], crop[:, :, 1], crop[:, :, 2]
    orange = (hsv[:, :, 0] >= 8) & (hsv[:, :, 0] <= 35) & (hsv[:, :, 1] > 70) & (hsv[:, :, 2] > 100)
    dark = (r + g + b) < 190
    raw = orange | dark
    alpha = raw.astype(np.uint8) * 255
    alpha = cv2.morphologyEx(alpha, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    alpha = cv2.dilate(alpha, np.ones((3, 3), np.uint8), iterations=1)
    out = np.zeros(rgb.shape[:2], dtype=np.uint8)
    out[y0:y1, x0:x1] = _soften(alpha, 5)
    return out


def _subject_grabcut(rgb: np.ndarray, rect: tuple[int, int, int, int]) -> np.ndarray:
    x0, y0, x1, y1 = rect
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    mask = np.zeros(rgb.shape[:2], dtype=np.uint8)
    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)
    cv2.grabCut(bgr, mask, (x0, y0, x1 - x0, y1 - y0), bgd_model, fgd_model, 5, cv2.GC_INIT_WITH_RECT)
    alpha = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    # Keep the fine rods and flowers, but remove isolated specks outside the sculpture area.
    alpha = cv2.morphologyEx(alpha, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    alpha = _soften(alpha, 3)
    hard_bounds = _rect_mask((rgb.shape[1], rgb.shape[0]), (x0 - 20, y0 - 20, x1 + 20, y1 + 20), 0)
    return np.where(hard_bounds > 0, alpha, 0).astype(np.uint8)


def _layer_from_alpha(rgb: np.ndarray, alpha: np.ndarray) -> Image.Image:
    rgba = np.dstack([rgb, alpha.astype(np.uint8)])
    return Image.fromarray(rgba, "RGBA")


def _save_layer_png(layer: Layer, filename: str) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    layer.image.save(OUT_DIR / filename)


def _inpaint_background(rgb: np.ndarray, masks: list[np.ndarray]) -> Image.Image:
    union = np.zeros(rgb.shape[:2], dtype=np.uint8)
    for mask in masks:
        union = np.maximum(union, np.where(mask > 16, 255, 0).astype(np.uint8))
    union = cv2.dilate(union, np.ones((9, 9), np.uint8), iterations=1)
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    repaired = cv2.inpaint(bgr, union, 5, cv2.INPAINT_TELEA)
    repaired_rgb = cv2.cvtColor(repaired, cv2.COLOR_BGR2RGB)
    return Image.fromarray(repaired_rgb, "RGB").convert("RGBA")


def _composite_layers(size: tuple[int, int], ordered_top_to_bottom: list[Layer]) -> Image.Image:
    canvas = Image.new("RGBA", size, (255, 255, 255, 255))
    for layer in reversed(ordered_top_to_bottom):
        if layer.visible:
            canvas = Image.alpha_composite(canvas, layer.image.convert("RGBA"))
    return canvas


def build_layers(source: Path) -> tuple[list[Layer], Image.Image]:
    src = Image.open(source).convert("RGB")
    rgb = np.array(src, dtype=np.uint8)
    width, height = src.size
    size = (width, height)

    subject = _subject_grabcut(rgb, (570, 35, 1125, 930))
    printer = _printer_mask(rgb, (1100, 65, width, 765))
    top_banner = _yellow_mask(rgb, (0, 0, 535, 105))
    top_text = _dark_mask(rgb, (25, 25, 455, 78), 180)
    title = _dark_or_yellow_mask(rgb, (35, 130, 585, 357), 175)
    subtitle = _dark_mask(rgb, (45, 384, 575, 430), 170)
    feature_row = _dark_mask(rgb, (45, 455, 560, 605), 185)
    detail_cards = _rect_mask(size, (32, 628, 571, 858), 18)
    price_card = _rect_mask(size, (22, 880, 360, 1130), 22)
    workflow_card = _rect_mask(size, (384, 905, 1232, 1128), 22)
    bottom_bar = _rect_mask(size, (0, 1148, width, height), 0)

    visible_masks = [
        bottom_bar,
        workflow_card,
        price_card,
        detail_cards,
        feature_row,
        subtitle,
        title,
        top_text,
        top_banner,
        printer,
        subject,
    ]
    background = _inpaint_background(rgb, visible_masks)
    original_reference = src.convert("RGBA")

    layer_specs = [
        LayerSpec("11 底部保障条", "11_bottom_warranty.png", bottom_bar),
        LayerSpec("10 服务流程卡", "10_workflow_card.png", workflow_card),
        LayerSpec("09 价格咨询卡", "09_price_card.png", price_card),
        LayerSpec("08 细节展示卡片", "08_detail_cards.png", detail_cards),
        LayerSpec("07 图标卖点行", "07_feature_icons.png", feature_row),
        LayerSpec("06 卖点副标题", "06_subtitle.png", subtitle),
        LayerSpec("05 主标题与黄线", "05_main_title.png", title),
        LayerSpec("04 顶部品牌文字", "04_top_brand_text.png", top_text),
        LayerSpec("03 顶部黄色品牌底", "03_top_yellow_banner.png", top_banner),
        LayerSpec("02 右侧打印机", "02_printer.png", printer),
        LayerSpec("01 主体模型", "01_figure_model.png", subject),
    ]

    layers = [Layer(spec.name, _layer_from_alpha(rgb, spec.alpha)) for spec in layer_specs]
    layers.append(Layer("00 背景近似修补", background))
    layers.append(Layer("原图参考 hidden", original_reference, visible=False))

    for layer, spec in zip(layers, [*layer_specs, LayerSpec("00 背景近似修补", "00_background_inpainted.png", np.zeros_like(subject))]):
        _save_layer_png(layer, spec.filename)
    _save_layer_png(layers[-1], "reference_original_hidden.png")

    return layers, original_reference


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(f"Source image not found: {SOURCE}")
    layers, original_reference = build_layers(SOURCE)
    width, height = original_reference.size

    preview = _composite_layers((width, height), layers)
    PREVIEW_OUT.parent.mkdir(parents=True, exist_ok=True)
    preview.save(PREVIEW_OUT)

    write_psd(
        PSD_OUT,
        width=width,
        height=height,
        layers=layers,
        composite=original_reference,
    )
    print(f"PSD: {PSD_OUT}")
    print(f"Preview: {PREVIEW_OUT}")
    print(f"Layers: {OUT_DIR}")
    print(f"Layer count: {len(layers)}")


if __name__ == "__main__":
    main()
