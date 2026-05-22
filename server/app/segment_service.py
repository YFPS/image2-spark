"""ML 抠图服务

v1：rembg 显著性分割（适合简单贴纸 / 单一主体）
v2（当前默认）：OpenCV GrabCut + 用户矩形 box prompt（多元素海报场景表现远好于 v1）

可经 env SEGMENT_BACKEND=grabcut|rembg 切换；默认 grabcut。
"""
from __future__ import annotations

import io
import logging
import os

import cv2
import httpx
import numpy as np
from PIL import Image

# 不要在模块顶层 import rembg —— rembg 顶层会做 backend 探测（在无 GPU 的某些云
# 服务器上会阻塞超过 30s 让进程启动卡死）。改为在 get_rembg_session() 内 lazy import，
# 与 SEGMENT_BACKEND=grabcut（默认）路径完全不触发 rembg。

from .config import get_settings

logger = logging.getLogger(__name__)

# Lazy singleton sessions. Keep optional ML backends out of the default startup path.
_session = None
_sam_predictor = None
_mobile_sam_predictor = None


def get_rembg_session():
    global _session
    if _session is None:
        from rembg import new_session  # lazy: 顶层 import 在某些环境会卡 import

        model = get_settings().rembg_model
        logger.info("初始化 rembg session model=%s（首次会下载模型）", model)
        _session = new_session(model)
    return _session


async def fetch_image_bytes(url: str) -> tuple[bytes, str]:
    """复用 proxy-image 同等的拉取逻辑；返回 (bytes, content_type)。
    抛 ValueError / httpx.HTTPError。"""
    if not url.startswith("https://"):
        raise ValueError("仅支持 https URL")
    settings = get_settings()
    async with httpx.AsyncClient(timeout=settings.openai_timeout) as client:
        r = await client.get(url)
    if r.status_code >= 400:
        raise httpx.HTTPStatusError(
            f"上游返回 {r.status_code}", request=r.request, response=r
        )
    ct = r.headers.get("Content-Type", "")
    if not ct.startswith("image/"):
        raise ValueError(f"非图片 Content-Type：{ct}")
    return r.content, ct


def segment_sync(
    img_bytes: bytes,
    x: float,
    y: float,
    w: float,
    h: float,
    padding_factor: float,
) -> bytes:
    """派发器：按 SEGMENT_BACKEND env 选择 grabcut（默认）或 rembg。
    同步阻塞；async handler 须用 asyncio.to_thread 包装。"""
    backend = get_settings().segment_backend
    if backend == "mobile_sam":
        return segment_mobile_sam(img_bytes, x, y, w, h, padding_factor)
    if backend == "sam":
        return segment_sam(img_bytes, x, y, w, h, padding_factor)
    if backend == "rembg":
        return segment_rembg(img_bytes, x, y, w, h, padding_factor)
    return segment_grabcut(img_bytes, x, y, w, h, padding_factor)


def _fill_inner_holes(alpha: np.ndarray) -> np.ndarray:
    """填充 alpha mask 中被前景包围的孤立 BG。

    输入 alpha：uint8 二值化（0 or 255）。
    输出 alpha：所有被 FG 完全包围的"洞"翻为 FG。

    实现：
      1. 把 BG (alpha==0) 视为前景作 mask（255）
      2. pad 一圈零，避免 fill 越界；从 (0,0) flood fill：能流到的是"真背景"
      3. flood fill 后剩下高亮的就是"内嵌孤岛"
      4. 去 padding，把这些孤岛加回 alpha
    """
    bg_white = (alpha == 0).astype(np.uint8) * 255  # BG → 255
    padded = cv2.copyMakeBorder(bg_white, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=255)
    ff_mask = np.zeros((padded.shape[0] + 2, padded.shape[1] + 2), np.uint8)
    # 从角点 (0,0)（pad 区）flood fill：连到边界的真 BG 被翻 0
    cv2.floodFill(padded, ff_mask, (0, 0), 0)
    inner_holes = padded[1:-1, 1:-1]  # 此时 inner_holes 仅在"内嵌孤岛"处为 255
    return np.where(inner_holes > 0, 255, alpha).astype(np.uint8)


def _keep_components_touching_rect(
    alpha: np.ndarray,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
) -> np.ndarray:
    """Keep only foreground components that overlap the user's seed rectangle."""
    H, W = alpha.shape[:2]
    rx0 = max(0, min(W, int(x0)))
    ry0 = max(0, min(H, int(y0)))
    rx1 = max(0, min(W, int(x1)))
    ry1 = max(0, min(H, int(y1)))
    if rx1 <= rx0 or ry1 <= ry0:
        return np.zeros_like(alpha, dtype=np.uint8)

    fg = (alpha > 0).astype(np.uint8)
    label_count, labels = cv2.connectedComponents(fg, connectivity=4)
    if label_count <= 1:
        return np.zeros_like(alpha, dtype=np.uint8)

    rect_labels = labels[ry0:ry1, rx0:rx1]
    rect_fg = fg[ry0:ry1, rx0:rx1] > 0
    candidate_labels = np.unique(rect_labels[rect_fg])
    candidate_labels = candidate_labels[candidate_labels != 0]
    if candidate_labels.size == 0:
        return np.zeros_like(alpha, dtype=np.uint8)

    component_areas = np.bincount(labels.ravel(), minlength=label_count)
    rect_overlaps = np.bincount(rect_labels[rect_fg].ravel(), minlength=label_count)
    best_label = int(candidate_labels[np.argmax(rect_overlaps[candidate_labels])])
    best_overlap = int(rect_overlaps[best_label])
    min_peer_overlap = max(16, int(best_overlap * 0.35))
    keep_labels = []
    for label in candidate_labels:
        overlap = int(rect_overlaps[label])
        area = int(component_areas[label])
        overlap_ratio = overlap / area if area else 0.0
        if int(label) == best_label or overlap >= min_peer_overlap or overlap_ratio >= 0.15:
            keep_labels.append(int(label))

    keep = np.isin(labels, keep_labels)
    return np.where(keep, alpha, 0).astype(np.uint8)


def segment_brush_mobile_sam(
    img_bytes: bytes,
    brush_mask_bytes: bytes,
) -> bytes:
    """笔刷 mask → MobileSAM 精细抠图（保留原图尺寸，便于前端 PSD 分层叠加）。

    输入：
      - img_bytes: 原图 PNG/JPEG bytes
      - brush_mask_bytes: 用户笔刷蒙版 PNG。约定：alpha > 0 = 用户涂抹区域。

    流程（核心是把 brush mask 转 SAM 三路 prompt 一起喂）：
      1. brush mask 转灰度二值
      2. 算紧凑 bbox（带 padding）→ SAM box prompt
      3. 在涂抹区内均匀采样正点 → SAM point prompt（增强主体定位）
      4. brush mask 缩到 256×256 作为 SAM mask_input（低分辨率 mask prompt）
      5. SAM 推理 multimask_output=True，选 score 最高的
      6. 对最终 alpha 做轻微 Gaussian feather（1px）抗锯齿

    返回：与原图同尺寸的 RGBA PNG，alpha 是 SAM 精细 mask。
    前端拿到后直接覆盖在原图上即可形成 PSD 分层效果。
    """
    img_pil = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    arr = np.array(img_pil)
    H, W = arr.shape[:2]

    # 1) 读 brush mask，缩放到原图尺寸（前端 canvas 已是原图 natural 尺寸，但兜底）
    bm_pil = Image.open(io.BytesIO(brush_mask_bytes))
    if bm_pil.size != (W, H):
        bm_pil = bm_pil.resize((W, H), Image.BILINEAR)
    if bm_pil.mode != "RGBA":
        bm_pil = bm_pil.convert("RGBA")
    bm_alpha = np.array(bm_pil.split()[-1])  # 取 alpha 通道
    brush_bin = (bm_alpha > 8).astype(np.uint8)  # 二值化

    if brush_bin.sum() < 16:
        raise ValueError("笔刷区域过小，请多涂一些")

    # 2) bbox prompt
    rows = np.where(brush_bin.any(axis=1))[0]
    cols = np.where(brush_bin.any(axis=0))[0]
    by0, by1 = int(rows[0]), int(rows[-1])
    bx0, bx1 = int(cols[0]), int(cols[-1])
    # 给 SAM 一点 padding，让模型有空间扩主体
    pad = max(8, int(max(by1 - by0, bx1 - bx0) * 0.08))
    bx0 = max(0, bx0 - pad)
    by0 = max(0, by0 - pad)
    bx1 = min(W - 1, bx1 + pad)
    by1 = min(H - 1, by1 + pad)
    box = np.array([bx0, by0, bx1, by1], dtype=np.float32)

    # 3) 在涂抹区内均匀采样正点（最多 8 个，按面积分布）
    ys, xs = np.where(brush_bin > 0)
    n_pts = min(8, max(3, ys.size // 5000))
    if ys.size > 0:
        idx = np.linspace(0, ys.size - 1, n_pts).astype(int)
        point_coords = np.stack([xs[idx], ys[idx]], axis=1).astype(np.float32)
        point_labels = np.ones(n_pts, dtype=np.int32)
    else:
        point_coords = None
        point_labels = None

    # 4) mask_input：SAM 要求 (1, 256, 256) 的 logit 形式低分辨率 mask
    mask_input_lr = cv2.resize(brush_bin.astype(np.float32), (256, 256), interpolation=cv2.INTER_LINEAR)
    # SAM 期望未归一化的 logit；用 +/-16 经验值
    mask_input_lr = (mask_input_lr * 32.0 - 16.0).astype(np.float32)
    mask_input = mask_input_lr[None, :, :]

    # 5) SAM 推理
    predictor = get_mobile_sam_predictor()
    predictor.set_image(arr)
    masks, scores, _logits = predictor.predict(
        point_coords=point_coords,
        point_labels=point_labels,
        box=box,
        mask_input=mask_input,
        multimask_output=True,
    )
    masks = np.asarray(masks)
    if masks.size == 0:
        raise RuntimeError("SAM 未返回 mask")
    if masks.ndim == 2:
        masks = masks[np.newaxis, :, :]
    scores_arr = np.asarray(scores)
    best_idx = int(np.argmax(scores_arr)) if scores_arr.size == masks.shape[0] else 0
    alpha = (masks[best_idx].astype(np.uint8)) * 255
    alpha = _fill_inner_holes(alpha)

    # 6) 1px Gaussian feather 抗锯齿
    alpha = cv2.GaussianBlur(alpha, (3, 3), 0.6)

    # 7) 输出与原图同尺寸的 RGBA PNG（不裁切，便于前端原位叠加）
    rgba = np.dstack([arr, alpha])
    out = Image.fromarray(rgba, mode="RGBA")
    buf = io.BytesIO()
    out.save(buf, format="PNG", optimize=False)
    return buf.getvalue()


def segment_grabcut(
    img_bytes: bytes,
    x: float,
    y: float,
    w: float,
    h: float,
    padding_factor: float = 1.0,
) -> bytes:
    """OpenCV GrabCut（GC_INIT_WITH_MASK 模式）：

    - 用户矩形内 → 可能前景 (GC_PR_FGD)
    - 用户矩形外 + 搜索窗(用户矩形 + 50% padding) 内 → 可能背景 (GC_PR_BGD)
    - 搜索窗外 → 确定背景 (GC_BGD)

    GrabCut 迭代时可以在"可能 BG"区域把和矩形内 FG 同色团的像素升为 FG，
    实现"用户漏框边缘也能补全"的效果；同时矩形内的白底像素会被降为 BG，
    解决"矩形过大带白边"的问题。
    """
    img_pil = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    arr = np.array(img_pil)  # (H, W, 3) RGB
    H, W = arr.shape[:2]

    # 1) 用户矩形钳到图边
    rx = max(0, int(round(x)))
    ry = max(0, int(round(y)))
    rx2 = min(W, int(round(x + w)))
    ry2 = min(H, int(round(y + h)))
    if rx2 - rx < 4 or ry2 - ry < 4:
        raise ValueError(f"用户矩形太小（{rx2 - rx}×{ry2 - ry}）")

    # 2) 搜索窗：用户矩形 + 50% padding，让算法在外延区也能扩 FG
    pad = max(int(max(w, h) * max(0.0, padding_factor)), 32)
    sx = max(0, rx - pad)
    sy = max(0, ry - pad)
    sx2 = min(W, rx2 + pad)
    sy2 = min(H, ry2 + pad)

    # 3) 构造初始 mask：
    #    - 默认全图 = GC_BGD（确定背景）
    #    - 搜索窗内 = GC_PR_BGD（可能背景，算法可升 FG）
    #    - 用户矩形内 = GC_PR_FGD（可能前景，算法可降 BG）
    mask = np.full((H, W), cv2.GC_BGD, dtype=np.uint8)
    mask[sy:sy2, sx:sx2] = cv2.GC_PR_BGD
    mask[ry:ry2, rx:rx2] = cv2.GC_PR_FGD

    bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)

    cv2.grabCut(bgr, mask, None, bgd_model, fgd_model, 5, cv2.GC_INIT_WITH_MASK)

    # GC_BGD=0 GC_FGD=1 GC_PR_BGD=2 GC_PR_FGD=3
    alpha = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    alpha = _keep_components_touching_rect(alpha, rx, ry, rx2, ry2)

    # 修：填充被前景"包围"的孤立 BG（典型场景：贴纸眼白、鼻孔、字内孔）
    # 算法：把 BG 区先 pad 一圈"确定 BG"再从角点 flood fill；
    # 能连到边界的就是真背景被翻 0；剩下高亮像素就是"内嵌孤岛"，全部翻为 FG。
    alpha = _fill_inner_holes(alpha)

    rows = np.where(alpha.any(axis=1))[0]
    cols = np.where(alpha.any(axis=0))[0]

    if rows.size == 0 or cols.size == 0:
        # GrabCut 把所有像素判为 BG → 兜底用用户矩形直接裁
        logger.warning("GrabCut 未识别出前景，回退按用户矩形裁切")
        ix = max(0, int(round(x)))
        iy = max(0, int(round(y)))
        ix2 = min(W, int(round(x + w)))
        iy2 = min(H, int(round(y + h)))
        out = Image.fromarray(arr[iy:iy2, ix:ix2]).convert("RGBA")
    else:
        soft_pad = 4
        y0 = int(max(0, rows[0] - soft_pad))
        y1 = int(min(H, rows[-1] + soft_pad + 1))
        x0 = int(max(0, cols[0] - soft_pad))
        x1 = int(min(W, cols[-1] + soft_pad + 1))
        rgba = np.dstack([arr[y0:y1, x0:x1], alpha[y0:y1, x0:x1]])
        out = Image.fromarray(rgba, mode="RGBA")

    buf = io.BytesIO()
    out.save(buf, format="PNG", optimize=False)
    return buf.getvalue()


def get_sam_predictor():
    """Load SAM lazily. The default grabcut/rembg backends must not require torch."""
    global _sam_predictor
    if _sam_predictor is not None:
        return _sam_predictor

    settings = get_settings()
    checkpoint = getattr(settings, "sam_checkpoint", "").strip()
    if not checkpoint:
        raise RuntimeError("SAM_CHECKPOINT is required when SEGMENT_BACKEND=sam")

    try:
        import torch
        from segment_anything import SamPredictor, sam_model_registry
    except ImportError as e:
        raise RuntimeError(
            "SAM backend requires torch and segment-anything. "
            "Install them before setting SEGMENT_BACKEND=sam."
        ) from e

    model_type = getattr(settings, "sam_model_type", "vit_b").strip() or "vit_b"
    if model_type not in sam_model_registry:
        valid = ", ".join(sorted(sam_model_registry.keys()))
        raise ValueError(f"Unsupported SAM_MODEL_TYPE={model_type!r}; expected one of: {valid}")

    device = getattr(settings, "sam_device", "auto").strip().lower() or "auto"
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"

    logger.info("Loading SAM model type=%s checkpoint=%s device=%s", model_type, checkpoint, device)
    sam = sam_model_registry[model_type](checkpoint=checkpoint)
    sam.to(device=device)
    _sam_predictor = SamPredictor(sam)
    return _sam_predictor


def segment_sam(
    img_bytes: bytes,
    x: float,
    y: float,
    w: float,
    h: float,
    padding_factor: float,
) -> bytes:
    """Segment Anything box-prompt backend.

    The user rectangle is the prompt box. SAM returns a full-image mask; we keep
    the best mask, fill internal holes, and crop tightly to the mask bbox.
    """
    _ = padding_factor
    img_pil = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    arr = np.array(img_pil)
    H, W = arr.shape[:2]

    rx = max(0, int(round(x)))
    ry = max(0, int(round(y)))
    rx2 = min(W, int(round(x + w)))
    ry2 = min(H, int(round(y + h)))
    if rx2 - rx < 4 or ry2 - ry < 4:
        raise ValueError(f"用户矩形太小（{rx2 - rx}x{ry2 - ry}）")

    predictor = get_sam_predictor()
    predictor.set_image(arr)
    box = np.array([rx, ry, rx2, ry2], dtype=np.float32)
    masks, scores, _logits = predictor.predict(box=box, multimask_output=True)

    masks = np.asarray(masks)
    if masks.size == 0:
        out = Image.fromarray(arr[ry:ry2, rx:rx2]).convert("RGBA")
    else:
        if masks.ndim == 2:
            masks = masks[np.newaxis, :, :]
        scores_arr = np.asarray(scores)
        best_idx = int(np.argmax(scores_arr)) if scores_arr.size == masks.shape[0] else 0
        alpha = masks[best_idx].astype(np.uint8) * 255
        alpha = _fill_inner_holes(alpha)

        rows = np.where(alpha.any(axis=1))[0]
        cols = np.where(alpha.any(axis=0))[0]
        if rows.size == 0 or cols.size == 0:
            out = Image.fromarray(arr[ry:ry2, rx:rx2]).convert("RGBA")
        else:
            soft_pad = 4
            y0 = int(max(0, rows[0] - soft_pad))
            y1 = int(min(H, rows[-1] + soft_pad + 1))
            x0 = int(max(0, cols[0] - soft_pad))
            x1 = int(min(W, cols[-1] + soft_pad + 1))
            rgba = np.dstack([arr[y0:y1, x0:x1], alpha[y0:y1, x0:x1]])
            out = Image.fromarray(rgba, mode="RGBA")

    buf = io.BytesIO()
    out.save(buf, format="PNG", optimize=False)
    return buf.getvalue()


def get_mobile_sam_predictor():
    """懒加载 MobileSAM；首次调用时载入，CPU/GPU 自动选择。

    依赖：mobile-sam (pip install git+https://github.com/ChaoningZhang/MobileSAM.git)
    权重：默认 server/models/mobile_sam/mobile_sam.pt，可通过 MOBILE_SAM_CHECKPOINT 覆盖。
    """
    global _mobile_sam_predictor
    if _mobile_sam_predictor is not None:
        return _mobile_sam_predictor

    settings = get_settings()
    checkpoint = settings.mobile_sam_checkpoint
    if not checkpoint or not os.path.exists(checkpoint):
        raise RuntimeError(
            f"MobileSAM 权重缺失：{checkpoint!r}。请下载 mobile_sam.pt 放至该路径，"
            "或设置 MOBILE_SAM_CHECKPOINT 指向已有文件。"
        )

    try:
        import torch
        from mobile_sam import SamPredictor, sam_model_registry
    except ImportError as e:
        raise RuntimeError(
            "mobile_sam 后端需要安装 mobile-sam（含 torch、timm）。"
            "pip install git+https://github.com/ChaoningZhang/MobileSAM.git timm"
        ) from e

    device = settings.mobile_sam_device
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"

    logger.info("加载 MobileSAM checkpoint=%s device=%s", checkpoint, device)
    sam = sam_model_registry["vit_t"](checkpoint=checkpoint)
    sam.to(device=device)
    sam.eval()
    _mobile_sam_predictor = SamPredictor(sam)
    return _mobile_sam_predictor


def segment_mobile_sam(
    img_bytes: bytes,
    x: float,
    y: float,
    w: float,
    h: float,
    padding_factor: float,
) -> bytes:
    """MobileSAM box-prompt 抠图。

    复用 segment_sam 的处理流程：用户矩形作为 box prompt → SAM 输出 mask →
    填洞 → 紧凑 bbox 裁剪 → RGBA PNG。
    """
    _ = padding_factor  # MobileSAM 不需要外扩窗
    img_pil = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    arr = np.array(img_pil)
    H, W = arr.shape[:2]

    rx = max(0, int(round(x)))
    ry = max(0, int(round(y)))
    rx2 = min(W, int(round(x + w)))
    ry2 = min(H, int(round(y + h)))
    if rx2 - rx < 4 or ry2 - ry < 4:
        raise ValueError(f"用户矩形太小（{rx2 - rx}x{ry2 - ry}）")

    predictor = get_mobile_sam_predictor()
    predictor.set_image(arr)
    box = np.array([rx, ry, rx2, ry2], dtype=np.float32)
    masks, scores, _logits = predictor.predict(box=box, multimask_output=True)

    masks = np.asarray(masks)
    if masks.size == 0:
        out = Image.fromarray(arr[ry:ry2, rx:rx2]).convert("RGBA")
    else:
        if masks.ndim == 2:
            masks = masks[np.newaxis, :, :]
        scores_arr = np.asarray(scores)
        best_idx = int(np.argmax(scores_arr)) if scores_arr.size == masks.shape[0] else 0
        alpha = masks[best_idx].astype(np.uint8) * 255
        alpha = _fill_inner_holes(alpha)

        rows = np.where(alpha.any(axis=1))[0]
        cols = np.where(alpha.any(axis=0))[0]
        if rows.size == 0 or cols.size == 0:
            out = Image.fromarray(arr[ry:ry2, rx:rx2]).convert("RGBA")
        else:
            soft_pad = 4
            y0 = int(max(0, rows[0] - soft_pad))
            y1 = int(min(H, rows[-1] + soft_pad + 1))
            x0 = int(max(0, cols[0] - soft_pad))
            x1 = int(min(W, cols[-1] + soft_pad + 1))
            rgba = np.dstack([arr[y0:y1, x0:x1], alpha[y0:y1, x0:x1]])
            out = Image.fromarray(rgba, mode="RGBA")

    buf = io.BytesIO()
    out.save(buf, format="PNG", optimize=False)
    return buf.getvalue()


def segment_rembg(
    img_bytes: bytes,
    x: float,
    y: float,
    w: float,
    h: float,
    padding_factor: float,
) -> bytes:
    """rembg 显著性分割（v1）。

    流程：
      1. PIL 解码 → RGB
      2. 扩展裁剪到搜索窗
      3. rembg.remove → RGBA（背景透明）
      4. 找 alpha > 0 的紧凑 bbox + 4 px 软边距
      5. 裁剪到 bbox，编码 PNG，返回 bytes
    返回的 PNG 已带透明背景。
    """
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    W, H = img.size

    # 1) 搜索窗（用户矩形向四周扩 max(edge × padding_factor, 64)）
    pad = max(max(w, h) * padding_factor, 64.0)
    sx = max(0.0, x - pad)
    sy = max(0.0, y - pad)
    sx2 = min(float(W), x + w + pad)
    sy2 = min(float(H), y + h + pad)
    sw = int(round(sx2 - sx))
    sh = int(round(sy2 - sy))
    if sw < 4 or sh < 4:
        raise ValueError(f"搜索窗太小（{sw}×{sh}）")

    cropped = img.crop((int(round(sx)), int(round(sy)), int(round(sx2)), int(round(sy2))))

    # 2) rembg 抠图（输入 RGB / 输出 RGBA）
    from rembg import remove  # lazy import；见 get_rembg_session 注释

    session = get_rembg_session()
    rgba = remove(cropped, session=session)
    if rgba.mode != "RGBA":
        rgba = rgba.convert("RGBA")

    # 3) 紧凑 bbox：找 alpha > 0 的最小外接矩形
    arr = np.array(rgba)  # shape: (sh, sw, 4)
    alpha = arr[:, :, 3]
    fg_rows = np.where(alpha.any(axis=1))[0]
    fg_cols = np.where(alpha.any(axis=0))[0]

    if fg_rows.size == 0 or fg_cols.size == 0:
        # 模型没识别出主体，回退到整张搜索窗（仍带 alpha=0 的透明像素）
        logger.warning("rembg 未识别出主体，回退返回整张搜索窗")
        out_img = rgba
    else:
        soft_pad = 4
        y0 = int(max(0, fg_rows[0] - soft_pad))
        y1 = int(min(sh, fg_rows[-1] + soft_pad + 1))
        x0 = int(max(0, fg_cols[0] - soft_pad))
        x1 = int(min(sw, fg_cols[-1] + soft_pad + 1))
        out_img = rgba.crop((x0, y0, x1, y1))

    # 4) 输出 PNG
    buf = io.BytesIO()
    out_img.save(buf, format="PNG", optimize=False)
    return buf.getvalue()
