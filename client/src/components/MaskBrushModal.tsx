import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Inpainting 蒙版涂抹工具
 *
 * 协议（与 server/app/routers/images.py 一致）：mask PNG 中 alpha=0 区域 = AI 重画。
 *
 * 实现：
 *  - 显示层 canvas（与原图同 natural 像素尺寸）：用户用半透明红色笔刷涂出"要修改的区域"，
 *    便于视觉确认；eraser 用 destination-out 抹掉。
 *  - 导出层（不显示）：先用纯白填充，再用 destination-out 把"显示层有像素"的位置打成透明 → 得到
 *    标准 OpenAI inpainting mask（alpha=0=改、alpha=255=保）。
 *
 * 与 StickerCropperModal 一致：图片走 dataURL（refImage 本身就是 dataURL），不需要走代理。
 */
export function MaskBrushModal({
  imageSrc,
  initialMask,
  onSave,
  onClose,
}: {
  imageSrc: string;
  initialMask?: Blob | null;
  onSave: (mask: Blob) => void;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const displayRef = useRef<HTMLCanvasElement | null>(null);

  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  const [tool, setTool] = useState<"brush" | "eraser">("brush");
  const [brushSize, setBrushSize] = useState(40);
  const [isPainting, setIsPainting] = useState(false);
  const [hasMask, setHasMask] = useState(false);

  const lastPt = useRef<{ x: number; y: number } | null>(null);

  // 图加载完成时，按 natural 尺寸初始化 canvas
  const onImgLoad = useCallback(() => {
    const img = imgRef.current;
    const cv = displayRef.current;
    if (!img || !cv) return;
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    setImgLoaded(true);
  }, []);

  // 若传入了既有 mask，加载进显示层（反推：mask 中 alpha=0 的像素 = 之前涂过）
  useEffect(() => {
    if (!imgLoaded || !initialMask) return;
    const cv = displayRef.current;
    if (!cv) return;
    const url = URL.createObjectURL(initialMask);
    const im = new Image();
    im.onload = () => {
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      // 取 mask 的 ImageData，把 alpha=0 的像素映射成半透明红
      const tmp = document.createElement("canvas");
      tmp.width = cv.width;
      tmp.height = cv.height;
      const tctx = tmp.getContext("2d")!;
      tctx.drawImage(im, 0, 0, cv.width, cv.height);
      const data = tctx.getImageData(0, 0, cv.width, cv.height);
      let anyMask = false;
      for (let i = 0; i < data.data.length; i += 4) {
        if (data.data[i + 3] === 0) {
          // 原 mask 透明 → 涂过
          data.data[i] = 255;
          data.data[i + 1] = 60;
          data.data[i + 2] = 90;
          data.data[i + 3] = 140;
          anyMask = true;
        } else {
          data.data[i + 3] = 0;
        }
      }
      ctx.putImageData(data, 0, 0);
      setHasMask(anyMask);
      URL.revokeObjectURL(url);
    };
    im.src = url;
  }, [imgLoaded, initialMask]);

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "[") setBrushSize((s) => Math.max(5, s - 5));
      if (e.key === "]") setBrushSize((s) => Math.min(200, s + 5));
      if (e.key === "b" || e.key === "B") setTool("brush");
      if (e.key === "e" || e.key === "E") setTool("eraser");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 屏幕坐标 → canvas natural 坐标
  const toNatural = useCallback((clientX: number, clientY: number) => {
    const cv = displayRef.current;
    if (!cv) return null;
    const rect = cv.getBoundingClientRect();
    const scaleX = cv.width / rect.width;
    const scaleY = cv.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
      // 屏幕缩放倍率（笔刷直径要按显示比例换算到 natural）
      scale: scaleX,
    };
  }, []);

  const strokeTo = useCallback(
    (clientX: number, clientY: number) => {
      const cv = displayRef.current;
      if (!cv) return;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      const pt = toNatural(clientX, clientY);
      if (!pt) return;
      const radius = (brushSize / 2) * pt.scale;

      ctx.save();
      if (tool === "brush") {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "rgba(255, 60, 90, 0.55)";
        ctx.strokeStyle = "rgba(255, 60, 90, 0.55)";
      } else {
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = "rgba(0,0,0,1)";
        ctx.strokeStyle = "rgba(0,0,0,1)";
      }
      ctx.lineWidth = radius * 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (lastPt.current) {
        ctx.beginPath();
        ctx.moveTo(lastPt.current.x, lastPt.current.y);
        ctx.lineTo(pt.x, pt.y);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      lastPt.current = { x: pt.x, y: pt.y };
      if (tool === "brush") setHasMask(true);
    },
    [brushSize, tool, toNatural],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setIsPainting(true);
    lastPt.current = null;
    strokeTo(e.clientX, e.clientY);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!isPainting) return;
    strokeTo(e.clientX, e.clientY);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    setIsPainting(false);
    lastPt.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const clearMask = () => {
    const cv = displayRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    setHasMask(false);
  };

  const handleSave = async () => {
    const cv = displayRef.current;
    if (!cv) return;
    // 导出层：白底，destination-out 用显示层打洞 → 标准 OpenAI mask
    const out = document.createElement("canvas");
    out.width = cv.width;
    out.height = cv.height;
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(cv, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      out.toBlob((b) => resolve(b), "image/png"),
    );
    if (blob) onSave(blob);
  };

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/82 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-[min(1200px,94vw)] flex-col gap-3 rounded-[24px] border border-white/[0.08] bg-[#0E0E11] p-5"
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[14px] font-medium text-white/92">涂抹蒙版（Inpainting）</span>
            <span className="text-[11.5px] text-white/45">
              用红色笔刷涂出要修改的区域；快捷键：B 笔刷 · E 橡皮 · [ ] 调整笔刷大小 · Esc 关闭
            </span>
          </div>
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full border border-white/[0.08] bg-[#17171b] text-white/72 hover:bg-[#1e1e22]"
          >
            ✕
          </button>
        </div>

        {/* 工具栏 */}
        <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-[14px] border border-white/[0.04] bg-[#141418] px-3 py-2">
          <div className="flex items-center gap-1 rounded-[10px] bg-[#1e1e22] p-[3px]">
            {(
              [
                { v: "brush", label: "笔刷" },
                { v: "eraser", label: "橡皮" },
              ] as const
            ).map((t) => (
              <button
                key={t.v}
                onClick={() => setTool(t.v)}
                className={`rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  tool === t.v
                    ? "bg-accent-foxo/14 text-accent-foxo ring-1 ring-inset ring-accent-foxo/30"
                    : "text-white/55 hover:bg-white/[0.04] hover:text-white/85"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11.5px] text-white/55">笔刷</span>
            <input
              type="range"
              min={5}
              max={200}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="w-[160px]"
            />
            <span className="w-9 text-[11.5px] tabular-nums text-white/70">{brushSize}px</span>
          </div>

          <button
            onClick={clearMask}
            className="rounded-[10px] border border-white/[0.06] bg-[#1e1e22] px-3 py-1.5 text-[12px] text-white/72 hover:bg-[#26262b]"
          >
            清空
          </button>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-[12px] border border-white/[0.06] bg-[#1e1e22] px-4 py-2 text-[12px] text-white/72 hover:bg-[#26262b]"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={!hasMask}
              className="rounded-[12px] bg-accent-foxo px-4 py-2 text-[12px] font-medium text-[#0D0D0D] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              确认蒙版
            </button>
          </div>
        </div>

        {/* 画布区 */}
        <div
          ref={containerRef}
          className="relative min-h-0 flex-1 overflow-hidden rounded-[16px] border border-white/[0.05] bg-[#0a0a0d]"
        >
          {imgError ? (
            <div className="grid h-full place-items-center text-[12px] text-red-400">
              {imgError}
            </div>
          ) : (
            <div className="relative grid h-full w-full place-items-center p-3">
              <div className="relative max-h-full max-w-full">
                <img
                  ref={imgRef}
                  src={imageSrc}
                  alt="待编辑图"
                  onLoad={onImgLoad}
                  onError={() => setImgError("图片加载失败")}
                  draggable={false}
                  className="block max-h-[72vh] max-w-full select-none rounded-[8px] object-contain"
                />
                <canvas
                  ref={displayRef}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  className="absolute inset-0 h-full w-full rounded-[8px]"
                  style={{
                    cursor:
                      tool === "brush"
                        ? "crosshair"
                        : "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'><circle cx='8' cy='8' r='6' fill='none' stroke='white' stroke-width='1.5'/></svg>\") 8 8, auto",
                    touchAction: "none",
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
