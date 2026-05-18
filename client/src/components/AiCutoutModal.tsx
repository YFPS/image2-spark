import { useCallback, useEffect, useRef, useState } from "react";
import { brushCutout, GenerateError } from "../api/gptImage";

/**
 * AI 抠图：用户涂粗略区域 → 后端 MobileSAM 沿真实主体边缘精化 → 返回 RGBA PNG。
 *
 * 流程：
 *  1. 用户涂出主体（笔刷 mask，绿色显示）
 *  2. 导出 brush mask PNG（alpha>0 = 用户涂抹）
 *  3. POST /api/images/brush-cutout（multipart：image + mask）
 *  4. 收到与原图同尺寸的 RGBA（alpha 是 SAM 精细 mask）→ 直接当顶层 PSD 图层叠加
 *
 * 不再调 gpt-image-2 /edit；速度从 30-60s 降到 1-3s，边缘真贴合内容。
 */
export function AiCutoutModal({
  imageSrc,
  onClose,
}: {
  imageSrc: string;
  onClose: () => void;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const displayRef = useRef<HTMLCanvasElement | null>(null);

  const [imgError, setImgError] = useState<string | null>(null);
  const [tool, setTool] = useState<"brush" | "eraser">("brush");
  const [brushSize, setBrushSize] = useState(60);
  const [isPainting, setIsPainting] = useState(false);
  const [hasMask, setHasMask] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultSrc, setResultSrc] = useState<string | null>(null);

  // PSD 风格图层拖拽：抠出的主体作为浮动图层，可在原图上拖动
  const [layerPos, setLayerPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragOrigin = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const lastPt = useRef<{ x: number; y: number } | null>(null);

  const onImgLoad = useCallback(() => {
    const img = imgRef.current;
    const cv = displayRef.current;
    if (!img || !cv) return;
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (loading) return;
      if (e.key === "Escape") onClose();
      if (e.key === "[") setBrushSize((s) => Math.max(5, s - 5));
      if (e.key === "]") setBrushSize((s) => Math.min(300, s + 5));
      if (e.key === "b" || e.key === "B") setTool("brush");
      if (e.key === "e" || e.key === "E") setTool("eraser");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, loading]);

  const toNatural = useCallback((clientX: number, clientY: number) => {
    const cv = displayRef.current;
    if (!cv) return null;
    const rect = cv.getBoundingClientRect();
    const scaleX = cv.width / rect.width;
    const scaleY = cv.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
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
        // 绿色半透明 = 表示"保留区域"，区别于 inpainting 模态的红色
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "rgba(80, 220, 130, 0.55)";
        ctx.strokeStyle = "rgba(80, 220, 130, 0.55)";
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
    if (loading || resultSrc) return;
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

  /**
   * 导出"笔刷区域 mask PNG"：alpha>0 = 用户涂抹。后端会把它当 SAM 的 mask_input + 采样正点 + bbox prompt。
   */
  const buildBrushMaskBlob = async (): Promise<Blob> => {
    const cv = displayRef.current!;
    const w = cv.width;
    const h = cv.height;
    const dispCtx = cv.getContext("2d")!;
    const dispData = dispCtx.getImageData(0, 0, w, h);
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d")!;
    const outData = ctx.createImageData(w, h);
    // 显示层 brush 半透明红，最大 alpha ≈ 140；放大到 0-255 同时保留 round-cap 渐变
    const SCALE = 255 / 140;
    for (let i = 0; i < dispData.data.length; i += 4) {
      const a = dispData.data[i + 3];
      const boosted = a > 0 ? Math.min(255, Math.round(a * SCALE)) : 0;
      outData.data[i] = 255;
      outData.data[i + 1] = 255;
      outData.data[i + 2] = 255;
      outData.data[i + 3] = boosted;
    }
    ctx.putImageData(outData, 0, 0);
    return new Promise<Blob>((resolve) =>
      out.toBlob((b) => resolve(b!), "image/png"),
    );
  };

  const handleSubmit = async () => {
    if (!hasMask || loading) return;
    setErrorMsg(null);
    setLoading(true);
    try {
      const imgResp = await fetch(imageSrc);
      const imageBlob = await imgResp.blob();
      const maskBlob = await buildBrushMaskBlob();
      const cutoutBlob = await brushCutout({
        imageBlob,
        maskBlob,
        subjectType: "auto",
      });
      const url = URL.createObjectURL(cutoutBlob);
      setResultSrc(url);
    } catch (e) {
      const msg =
        e instanceof GenerateError
          ? `${e.apiError.code}：${e.apiError.message}`
          : e instanceof Error
            ? e.message
            : String(e);
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  const downloadResult = () => {
    if (!resultSrc) return;
    const a = document.createElement("a");
    a.href = resultSrc;
    a.download = `cutout-${Date.now()}.png`;
    a.click();
  };

  const resetForRetry = () => {
    if (resultSrc?.startsWith("blob:")) URL.revokeObjectURL(resultSrc);
    setResultSrc(null);
    setErrorMsg(null);
    setLayerPos({ x: 0, y: 0 });
  };

  const resetLayerPos = () => setLayerPos({ x: 0, y: 0 });

  const onLayerPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragOrigin.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: layerPos.x,
      origY: layerPos.y,
    };
    setDragging(true);
  };
  const onLayerPointerMove = (e: React.PointerEvent) => {
    if (!dragOrigin.current) return;
    setLayerPos({
      x: dragOrigin.current.origX + (e.clientX - dragOrigin.current.startX),
      y: dragOrigin.current.origY + (e.clientY - dragOrigin.current.startY),
    });
  };
  const onLayerPointerUp = (e: React.PointerEvent) => {
    dragOrigin.current = null;
    setDragging(false);
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  // 关闭模态时回收 blob URL
  useEffect(() => {
    return () => {
      if (resultSrc?.startsWith("blob:")) URL.revokeObjectURL(resultSrc);
    };
  }, [resultSrc]);

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/82 backdrop-blur-md"
      onClick={loading ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-[min(1400px,96vw)] flex-col gap-3 rounded-[24px] border border-white/[0.08] bg-[#0E0E11] p-5"
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[14px] font-medium text-white/92">AI 抠图（笔刷 + 重绘）</span>
            <span className="text-[11.5px] text-white/45">
              用绿色笔刷涂出要保留的主体；快捷键：B 笔刷 · E 橡皮 · [ ] 笔刷大小 · Esc 关闭
            </span>
          </div>
          <button
            disabled={loading}
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full border border-white/[0.08] bg-[#17171b] text-white/72 hover:bg-[#1e1e22] disabled:opacity-40"
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
                disabled={loading || !!resultSrc}
                className={`rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  tool === t.v
                    ? "bg-accent-foxo/14 text-accent-foxo ring-1 ring-inset ring-accent-foxo/30"
                    : "text-white/55 hover:bg-white/[0.04] hover:text-white/85"
                } disabled:opacity-40`}
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
              max={300}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              disabled={loading || !!resultSrc}
              className="w-[160px]"
            />
            <span className="w-9 text-[11.5px] tabular-nums text-white/70">{brushSize}px</span>
          </div>

          <button
            onClick={clearMask}
            disabled={loading || !!resultSrc}
            className="rounded-[10px] border border-white/[0.06] bg-[#1e1e22] px-3 py-1.5 text-[12px] text-white/72 hover:bg-[#26262b] disabled:opacity-40"
          >
            清空
          </button>

          <div className="ml-auto flex items-center gap-2">
            {resultSrc ? (
              <>
                <button
                  onClick={resetForRetry}
                  className="rounded-[12px] border border-white/[0.06] bg-[#1e1e22] px-4 py-2 text-[12px] text-white/72 hover:bg-[#26262b]"
                >
                  重新涂抹
                </button>
                <button
                  onClick={downloadResult}
                  className="rounded-[12px] bg-accent-foxo px-4 py-2 text-[12px] font-medium text-[#0D0D0D] hover:brightness-95"
                >
                  下载 PNG
                </button>
              </>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!hasMask || loading}
                className="flex items-center gap-2 rounded-[12px] bg-accent-foxo px-4 py-2 text-[12px] font-medium text-[#0D0D0D] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loading ? "精化中…" : "开始抠图"}
              </button>
            )}
          </div>
        </div>

        {/* 错误条 */}
        {errorMsg && (
          <div className="shrink-0 rounded-[12px] border border-red-500/30 bg-[#1a0e10] px-3 py-2 text-[11.5px] text-red-400">
            {errorMsg}
          </div>
        )}

        {/* 双栏：左=涂抹区，右=结果 */}
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
          {/* 左：涂抹画布 */}
          <div className="relative min-h-0 overflow-hidden rounded-[16px] border border-white/[0.05] bg-[#0a0a0d]">
            <div className="absolute left-3 top-3 z-10 rounded-full bg-black/55 px-2.5 py-1 text-[10.5px] text-white/82">
              原图 · 涂出主体
            </div>
            {imgError ? (
              <div className="grid h-full place-items-center text-[12px] text-red-400">
                {imgError}
              </div>
            ) : (
              <div className="grid h-full w-full place-items-center p-3">
                <div className="relative max-h-full max-w-full">
                  <img
                    ref={imgRef}
                    src={imageSrc}
                    alt="原图"
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
                      cursor: resultSrc || loading ? "default" : "crosshair",
                      touchAction: "none",
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* 右：PSD 风格分层 —— 底层完整原图 + 顶层可拖拽的 AI 抠图层 */}
          <div className="relative min-h-0 overflow-hidden rounded-[16px] border border-white/[0.05] bg-[#0a0a0d]">
            <div className="absolute left-3 top-3 z-10 rounded-full bg-black/55 px-2.5 py-1 text-[10.5px] text-white/82">
              {resultSrc ? "分层结果 · 拖动顶层抠图" : "结果"}
            </div>
            {resultSrc && (
              <button
                onClick={resetLayerPos}
                className="absolute right-3 top-3 z-10 rounded-full border border-white/[0.10] bg-[#17171b]/82 px-3 py-1 text-[11px] text-white/72 backdrop-blur-md hover:bg-[#1e1e22]"
              >
                复位
              </button>
            )}
            <div className="grid h-full w-full place-items-center p-3">
              {loading ? (
                <div className="flex flex-col items-center gap-3 text-white/55">
                  <div className="h-7 w-7 animate-spin rounded-full border-2 border-white/15 border-t-accent-foxo" />
                  <span className="text-[12px]">MobileSAM 精化中…通常 1–3 秒</span>
                </div>
              ) : resultSrc ? (
                <div className="relative inline-block max-h-full max-w-full">
                  {/* 底层：完整原图（不动）*/}
                  <img
                    src={imageSrc}
                    alt="底层原图"
                    className="block max-h-[72vh] max-w-full select-none object-contain"
                    draggable={false}
                  />
                  {/* 顶层：抠出的主体，可拖拽（natural 尺寸与原图一致 → 初始严丝合缝叠在原位）*/}
                  <img
                    src={resultSrc}
                    alt="抠图图层"
                    onPointerDown={onLayerPointerDown}
                    onPointerMove={onLayerPointerMove}
                    onPointerUp={onLayerPointerUp}
                    onPointerCancel={onLayerPointerUp}
                    draggable={false}
                    className="pointer-events-auto absolute inset-0 h-full w-full select-none object-contain"
                    style={{
                      transform: `translate(${layerPos.x}px, ${layerPos.y}px)`,
                      cursor: dragging ? "grabbing" : "grab",
                      touchAction: "none",
                      transition: dragging ? "none" : "transform 0.18s ease-out",
                      filter: dragging
                        ? "drop-shadow(0 8px 24px rgba(0,0,0,0.45))"
                        : "drop-shadow(0 2px 8px rgba(0,0,0,0.25))",
                    }}
                  />
                </div>
              ) : (
                <span className="text-[12px] text-white/35">
                  在左边涂抹主体后，点「开始 AI 抠图」
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
