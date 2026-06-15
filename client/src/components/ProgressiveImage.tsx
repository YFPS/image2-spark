import { useState } from "react";

/**
 * 渐进式图片组件 —— 支持懒加载 + 加载态占位 + 错误兜底。
 * 移动端友好：loading="lazy" 让浏览器延迟加载视口外的图片。
 */
export function ProgressiveImage({
  src,
  alt,
  className = "",
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {!loaded && !error && (
        <div className="absolute inset-0 animate-pulse bg-white/5" />
      )}

      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={`block h-full w-full object-cover transition-opacity duration-300 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
      />

      {error && (
        <div className="absolute inset-0 grid place-items-center bg-white/5">
          <span className="text-[12px] text-white/30">加载失败</span>
        </div>
      )}
    </div>
  );
}
