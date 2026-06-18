import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { safeImageSrc, segmentImage, GenerateError, customerErrorMessage } from "../api/gptImage";

/** 自然像素坐标系的矩形选区 */
type Selection = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

type DrawingRect = {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
};

const MIN_SIZE = 16; // 选区最短边阈值（自然像素），低于此忽略

/**
 * 抠图工具：源图上框选 → 白→透明阈值处理 → ZIP 打包下载
 *
 * - 源图按 safeImageSrc 转代理 URL（避免 canvas 跨域 taint）
 * - 框选坐标存储为源图自然像素，显示时按缩放比换算
 * - 阈值滑条仅影响下次导出，不实时重绘
 */
export function StickerCropperModal({
  src,
  onClose,
}: {
  src: string;
  onClose: () => void;
}) {
  const proxiedSrc = useMemo(() => safeImageSrc(src), [src]);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [drawing, setDrawing] = useState<DrawingRect | null>(null);
  const [threshold, setThreshold] = useState(240);
  const [exporting, setExporting] = useState(false);

  // ESC 关闭（导出中不响应）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !exporting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, exporting]);

  // 屏幕坐标 → 自然像素坐标
  const screenToNatural = useCallback((clientX: number, clientY: number) => {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    const scaleX = img.naturalWidth / rect.width;
    const scaleY = img.naturalHeight / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    return { x, y };
  }, []);

  // 自然像素 → 屏幕显示偏移（相对 stage 容器左上角）
  const naturalToScreen = useCallback((nx: number, ny: number) => {
    const img = imgRef.current;
    const stage = stageRef.current;
    if (!img || !stage) return { x: 0, y: 0 };
    const imgRect = img.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const scaleX = imgRect.width / img.naturalWidth;
    const scaleY = imgRect.height / img.naturalHeight;
    return {
      x: imgRect.left - stageRect.left + nx * scaleX,
      y: imgRect.top - stageRect.top + ny * scaleY,
      sx: scaleX,
      sy: scaleY,
    };
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    if (!imgLoaded || exporting) return;
    const pt = screenToNatural(e.clientX, e.clientY);
    if (!pt) return;
    setDrawing({ startX: pt.x, startY: pt.y, curX: pt.x, curY: pt.y });
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!drawing) return;
    const pt = screenToNatural(e.clientX, e.clientY);
    if (!pt) return;
    setDrawing({ ...drawing, curX: pt.x, curY: pt.y });
  };
  const onMouseUp = () => {
    if (!drawing) return;
    const x = Math.min(drawing.startX, drawing.curX);
    const y = Math.min(drawing.startY, drawing.curY);
    const w = Math.abs(drawing.curX - drawing.startX);
    const h = Math.abs(drawing.curY - drawing.startY);
    setDrawing(null);
    if (w < MIN_SIZE || h < MIN_SIZE) return; // 防误点
    const img = imgRef.current;
    if (!img) return;
    // 钳到图片范围内
    const clampedX = Math.max(0, Math.min(x, img.naturalWidth));
    const clampedY = Math.max(0, Math.min(y, img.naturalHeight));
    const clampedW = Math.min(w, img.naturalWidth - clampedX);
    const clampedH = Math.min(h, img.naturalHeight - clampedY);
    if (clampedW < MIN_SIZE || clampedH < MIN_SIZE) return;
    setSelections((s) => [
      ...s,
      {
        id: crypto.randomUUID(),
        x: clampedX,
        y: clampedY,
        w: clampedW,
        h: clampedH,
      },
    ]);
  };

  const deleteSelection = (id: string) => {
    setSelections((s) => s.filter((x) => x.id !== id));
  };

  // 后端 ML 抠图能否使用：data: URI 走不了，因为后端拉的是 url
  const canUseBackend = !src.startsWith("data:");

  const exportZip = async () => {
    const img = imgRef.current;
    if (!img || selections.length === 0 || exporting) return;
    setExporting(true);
    try {
      const zip = new JSZip();
      for (let i = 0; i < selections.length; i++) {
        const sel = selections[i];
        let blob: Blob | null = null;
        if (canUseBackend) {
          // 优先调后端 ML 抠图
          try {
            blob = await segmentImage({
              url: src,
              x: sel.x,
              y: sel.y,
              w: sel.w,
              h: sel.h,
              padding_factor: 1.0,
            });
          } catch (err) {
            console.warn(
              `[cropper] backend segment failed for #${i + 1}, fallback to local:`,
              err,
            );
            blob = await exportSelection(img, sel, threshold);
          }
        } else {
          // data: URI 直接走前端阈值法
          blob = await exportSelection(img, sel, threshold);
        }
        if (blob) zip.file(`sticker-${i + 1}.png`, blob);
      }
      const out = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(out);
      const a = document.createElement("a");
      a.href = url;
      a.download = "stickers.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("[cropper] export failed:", e);
      const msg = e instanceof GenerateError ? customerErrorMessage(e.apiError, "图片处理失败，请稍后重试") : e instanceof Error ? e.message : String(e);
      alert(`导出失败：${msg}`);
    } finally {
      setExporting(false);
    }
  };

  // 当前正在拖的临时矩形（屏幕坐标）
  const drawingOverlay = drawing
    ? (() => {
        const x = Math.min(drawing.startX, drawing.curX);
        const y = Math.min(drawing.startY, drawing.curY);
        const w = Math.abs(drawing.curX - drawing.startX);
        const h = Math.abs(drawing.curY - drawing.startY);
        const p = naturalToScreen(x, y);
        return {
          left: p.x,
          top: p.y,
          width: w * (p.sx ?? 1),
          height: h * (p.sy ?? 1),
        };
      })()
    : null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/82 p-6 backdrop-blur-md"
      onClick={() => !exporting && onClose()}
    >
      <div
        className="flex max-h-[90vh] w-[1280px] max-w-[95vw] flex-col overflow-hidden rounded-[24px] border border-white/[0.06] bg-[#0E0E11]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶栏 */}
        <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-5 py-3">
          <span className="text-[13px] font-medium text-white/92">✂ 抠图工具</span>
          <span className="text-[11px] text-white/40">
            {canUseBackend ? "AI 抠图 · rembg" : "框选矩形 → 白→透明（fallback）"}
          </span>

          <div
            className={`ml-6 flex items-center gap-2 ${
              canUseBackend ? "opacity-40" : ""
            }`}
            title={canUseBackend ? "AI 抠图无需阈值；仅 fallback 时生效" : undefined}
          >
            <span className="text-[11px] text-white/55">阈值</span>
            <input
              type="range"
              min={200}
              max={250}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              disabled={exporting || canUseBackend}
              className="w-32 accent-accent-foxo"
            />
            <span className="tnum w-8 text-[11px] text-white/72">{threshold}</span>
          </div>

          <span className="ml-4 text-[11px] text-white/40">
            选区 {selections.length}
          </span>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={exportZip}
              disabled={selections.length === 0 || exporting}
              className="flex items-center gap-2 rounded-full bg-accent-foxo px-4 py-2 text-[12px] font-semibold text-[#0D0D0D] shadow-generate-glow disabled:opacity-40"
            >
              {exporting ? <SpinDot /> : null}
              {exporting ? "打包中…" : "下载 ZIP"}
            </button>
            <button
              onClick={() => !exporting && onClose()}
              disabled={exporting}
              title="关闭"
              className="grid h-9 w-9 place-items-center rounded-full border border-white/[0.08] bg-[#17171b] text-white/72 hover:bg-[#1e1e22] disabled:opacity-40"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 主区：画布 | 列表 */}
        <div className="flex min-h-0 flex-1">
          {/* 画布 */}
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#08080A] p-6">
            {imgError ? (
              <div className="text-[13px] text-red-400">加载失败：{imgError}</div>
            ) : (
              <div
                ref={stageRef}
                className="relative select-none"
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={() => setDrawing(null)}
              >
                <img
                  ref={imgRef}
                  src={proxiedSrc}
                  alt=""
                  crossOrigin="anonymous"
                  draggable={false}
                  onLoad={() => setImgLoaded(true)}
                  onError={() => setImgError("无法加载源图")}
                  className="block max-h-[70vh] max-w-[60vw] cursor-crosshair rounded-[8px]"
                />

                {/* 已确认选区 */}
                {imgLoaded &&
                  selections.map((sel, i) => {
                    const p = naturalToScreen(sel.x, sel.y);
                    return (
                      <div
                        key={sel.id}
                        className="pointer-events-none absolute"
                        style={{
                          left: p.x,
                          top: p.y,
                          width: sel.w * (p.sx ?? 1),
                          height: sel.h * (p.sy ?? 1),
                          border: "1.5px solid #CCFF00",
                          outline: "0.5px solid rgba(0,0,0,0.4)",
                          background: "rgba(204,255,0,0.10)",
                        }}
                      >
                        <span className="pointer-events-none absolute -top-[18px] left-0 rounded-tl-[4px] rounded-tr-[4px] bg-accent-foxo px-1.5 text-[10px] font-medium text-[#0D0D0D]">
                          {i + 1}
                        </span>
                      </div>
                    );
                  })}

                {/* 拖拽中的临时矩形 */}
                {drawingOverlay && (
                  <div
                    className="pointer-events-none absolute"
                    style={{
                      ...drawingOverlay,
                      border: "1.5px dashed #CCFF00",
                      background: "rgba(204,255,0,0.06)",
                    }}
                  />
                )}
              </div>
            )}
            {!imgLoaded && !imgError && (
              <div className="absolute inset-0 grid place-items-center text-[12px] text-white/45">
                加载源图…
              </div>
            )}
          </div>

          {/* 右侧列表 */}
          <div className="flex w-[280px] shrink-0 flex-col border-l border-white/[0.06] bg-[#101013]">
            <div className="border-b border-white/[0.04] px-4 py-3 text-[12px] text-white/72">
              选区列表
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-color:rgba(255,255,255,0.16)_transparent] [scrollbar-width:thin]">
              {selections.length === 0 ? (
                <div className="grid h-full place-items-center text-center text-[11px] text-white/35">
                  在左侧画面上
                  <br />
                  按住鼠标拖拽出矩形
                </div>
              ) : (
                <div className="space-y-2">
                  {selections.map((sel, i) => (
                    <SelectionRow
                      key={sel.id}
                      index={i}
                      sel={sel}
                      src={proxiedSrc}
                      naturalW={imgRef.current?.naturalWidth ?? 1}
                      naturalH={imgRef.current?.naturalHeight ?? 1}
                      onDelete={() => deleteSelection(sel.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 单个选区列表行（CSS background-position 切片做缩略图，零 canvas 开销） */
function SelectionRow({
  index,
  sel,
  src,
  naturalW,
  naturalH,
  onDelete,
}: {
  index: number;
  sel: Selection;
  src: string;
  naturalW: number;
  naturalH: number;
  onDelete: () => void;
}) {
  // 缩略图固定 56×56，CSS 把整张源图 scale 到能让 sel 区域映到 56×56
  const thumbSize = 56;
  const scaleX = thumbSize / sel.w;
  const scaleY = thumbSize / sel.h;
  const bgW = naturalW * scaleX;
  const bgH = naturalH * scaleY;
  const bgX = -sel.x * scaleX;
  const bgY = -sel.y * scaleY;

  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-white/[0.04] bg-[#141418] p-2 hover:bg-[#16161a]">
      <div
        className="shrink-0 rounded-[6px] border border-white/[0.06] bg-white"
        style={{
          width: thumbSize,
          height: thumbSize,
          backgroundImage: `url("${src}")`,
          backgroundSize: `${bgW}px ${bgH}px`,
          backgroundPosition: `${bgX}px ${bgY}px`,
          backgroundRepeat: "no-repeat",
        }}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-white/86">sticker-{index + 1}.png</div>
        <div className="tnum text-[10.5px] text-white/45">
          {Math.round(sel.w)}×{Math.round(sel.h)}
        </div>
      </div>
      <button
        onClick={onDelete}
        title="删除"
        className="grid h-7 w-7 place-items-center rounded-full text-white/55 hover:bg-white/[0.06] hover:text-white/85"
      >
        ✕
      </button>
    </div>
  );
}

/** 顶栏导出按钮里的小 spinner */
function SpinDot() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * 自动物体分割导出：
 * 1) 用户矩形仅作种子提示；BFS 从矩形内的前景像素出发，沿 4-邻接扩到完整连通分量
 * 2) 物体可越出用户矩形（自动补全漏选的边）
 * 3) 输出 PNG = 物体紧凑 bbox + 4px 软边距，白底像素 alpha→0
 */
async function exportSelection(
  srcImg: HTMLImageElement,
  userSel: Selection,
  threshold: number,
): Promise<Blob | null> {
  // 1) 搜索窗：用户矩形向四周各扩 max(edge×1.0, 64)
  const pad = Math.max(Math.max(userSel.w, userSel.h) * 1.0, 64);
  const sx = Math.max(0, userSel.x - pad);
  const sy = Math.max(0, userSel.y - pad);
  const sx2 = Math.min(srcImg.naturalWidth, userSel.x + userSel.w + pad);
  const sy2 = Math.min(srcImg.naturalHeight, userSel.y + userSel.h + pad);
  const sw = Math.round(sx2 - sx);
  const sh = Math.round(sy2 - sy);
  if (sw < 4 || sh < 4) return null;

  const searchCanvas = document.createElement("canvas");
  searchCanvas.width = sw;
  searchCanvas.height = sh;
  const sctx = searchCanvas.getContext("2d", { willReadFrequently: true });
  if (!sctx) return null;
  sctx.drawImage(srcImg, sx, sy, sw, sh, 0, 0, sw, sh);
  const imgData = sctx.getImageData(0, 0, sw, sh);

  // 2) 把 userSel 映射到 imgData 坐标系
  const ux0 = clamp(Math.floor(userSel.x - sx), 0, sw);
  const uy0 = clamp(Math.floor(userSel.y - sy), 0, sh);
  const ux1 = clamp(Math.floor(userSel.x + userSel.w - sx), 0, sw);
  const uy1 = clamp(Math.floor(userSel.y + userSel.h - sy), 0, sh);

  // 3) 找连通分量 bbox（前景阈值比白→透明阈值更松，照顾抗锯齿边）
  const fgThreshold = Math.max(180, threshold - 20);
  const bbox = segmentObject(imgData, ux0, uy0, ux1, uy1, fgThreshold);

  // 4) 兜底：用户矩形全落白背景上 → 直接按用户矩形切
  let fx: number, fy: number, fw: number, fh: number;
  if (bbox) {
    const softPad = 4;
    fx = Math.max(0, bbox.x0 - softPad);
    fy = Math.max(0, bbox.y0 - softPad);
    const fx2 = Math.min(sw, bbox.x1 + softPad + 1);
    const fy2 = Math.min(sh, bbox.y1 + softPad + 1);
    fw = fx2 - fx;
    fh = fy2 - fy;
  } else {
    fx = ux0;
    fy = uy0;
    fw = Math.max(1, ux1 - ux0);
    fh = Math.max(1, uy1 - uy0);
  }

  // 5) 二次裁剪到 finalCanvas（输出像素 = 物体自然像素）
  const finalCanvas = document.createElement("canvas");
  finalCanvas.width = fw;
  finalCanvas.height = fh;
  const fctx = finalCanvas.getContext("2d", { willReadFrequently: true });
  if (!fctx) return null;
  fctx.drawImage(searchCanvas, fx, fy, fw, fh, 0, 0, fw, fh);

  // 6) 白 → 透明（平滑过渡）
  const fdata = fctx.getImageData(0, 0, fw, fh);
  const fd = fdata.data;
  const range = 255 - threshold;
  for (let i = 0; i < fd.length; i += 4) {
    const minRGB = Math.min(fd[i], fd[i + 1], fd[i + 2]);
    if (minRGB >= threshold) {
      const dist = 255 - minRGB;
      fd[i + 3] = range > 0 ? Math.round((dist / range) * 255) : 0;
    }
  }
  fctx.putImageData(fdata, 0, 0);

  return new Promise<Blob | null>((resolve) => {
    finalCanvas.toBlob((b) => resolve(b), "image/png");
  });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 在 imgData 内做"连通分量 bbox"：
 *   - 仅在 userSel 区域内寻找前景种子
 *   - 启动 4-邻接图遍历（push/pop 栈 DFS，省内存）
 *   - 遍历可越出 userSel 但不可越出 imgData 边界
 *   - 流式累加 min/max 得到完整 bbox（searchData 坐标系）
 * 无种子时返回 null。
 */
function segmentObject(
  imgData: ImageData,
  ux0: number,
  uy0: number,
  ux1: number,
  uy1: number,
  fgThreshold: number,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const { width, height, data } = imgData;
  const visited = new Uint8Array(width * height);
  const stack: number[] = []; // 编码 idx = y*width + x

  const isFG = (idx: number): boolean => {
    const p = idx * 4;
    return Math.min(data[p], data[p + 1], data[p + 2]) < fgThreshold;
  };

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let found = false;

  // 仅在用户矩形内播种
  for (let y = uy0; y < uy1; y++) {
    for (let x = ux0; x < ux1; x++) {
      const seed = y * width + x;
      if (visited[seed]) continue;
      if (!isFG(seed)) continue;

      stack.push(seed);
      visited[seed] = 1;

      while (stack.length) {
        const pos = stack.pop()!;
        const px = pos % width;
        const py = (pos - px) / width;

        if (px < x0) x0 = px;
        if (py < y0) y0 = py;
        if (px > x1) x1 = px;
        if (py > y1) y1 = py;
        found = true;

        // 4-邻接
        if (px > 0) {
          const n = pos - 1;
          if (!visited[n] && isFG(n)) {
            visited[n] = 1;
            stack.push(n);
          }
        }
        if (px < width - 1) {
          const n = pos + 1;
          if (!visited[n] && isFG(n)) {
            visited[n] = 1;
            stack.push(n);
          }
        }
        if (py > 0) {
          const n = pos - width;
          if (!visited[n] && isFG(n)) {
            visited[n] = 1;
            stack.push(n);
          }
        }
        if (py < height - 1) {
          const n = pos + width;
          if (!visited[n] && isFG(n)) {
            visited[n] = 1;
            stack.push(n);
          }
        }
      }
    }
  }

  return found ? { x0, y0, x1, y1 } : null;
}

/** 入口剪刀图标，供 ResultImage hover bar 使用 */
export function ScissorsIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  );
}
