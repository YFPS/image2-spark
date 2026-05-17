// gpt-image-2 出图后端代理 client（前端调 /api，由 Vite proxy 或 nginx 转发到 FastAPI）

export type GenerateRequest = {
  prompt: string;
  /** 模型名，目前支持 "gpt-image-2"、"banana-nano-pro" 等 */
  model?: string;
  size: string;
  quality: string;
  n: number;
  background: string;
  output_format: string;
  output_compression?: number;
  moderation: string;
  reasoning?: boolean;
};

export type GenerateImage = {
  url: string | null;
  b64_json: string | null;
};

export type GenerateUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
};

export type GenerateResponse = {
  images: GenerateImage[];
  usage: GenerateUsage;
  model: string;
};

export type ApiError = {
  code: string;
  message: string;
  upstream_status?: number;
};

export class GenerateError extends Error {
  apiError: ApiError;
  constructor(apiError: ApiError) {
    super(apiError.message);
    this.apiError = apiError;
  }
}

/** 把 UI 的全角 × 映射为 API 的 x */
export function normalizeSize(size: string): string {
  return size.replace(/×/g, "x");
}

export async function generateImages(req: GenerateRequest): Promise<GenerateResponse> {
  const body: GenerateRequest = {
    ...req,
    model: req.model ?? "gpt-image-2",
    size: normalizeSize(req.size),
  };

  const res = await fetch("/api/images/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let apiError: ApiError = { code: "http_error", message: `HTTP ${res.status}` };
    try {
      const j = await res.json();
      if (j.error) apiError = j.error;
      else if (j.detail) apiError.message = String(j.detail);
    } catch {
      /* 忽略解析错误 */
    }
    throw new GenerateError(apiError);
  }

  return (await res.json()) as GenerateResponse;
}

/** 把后端返回的 image 转成可用的 <img src> */
export function imageToSrc(img: GenerateImage, format = "png"): string | null {
  if (img.url) return img.url;
  if (img.b64_json) return `data:image/${format};base64,${img.b64_json}`;
  return null;
}

/**
 * 把任意 src 转换为对 canvas 安全（无 CORS taint）的 URL：
 * - data: URI 直接返回
 * - http(s) URL 经后端 /api/images/proxy-image 同源代理
 */
export function safeImageSrc(src: string): string {
  if (src.startsWith("data:")) return src;
  return `/api/images/proxy-image?url=${encodeURIComponent(src)}`;
}

/* ─── 后端 ML 抠图 ─── */

export type SegmentRequest = {
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
  padding_factor?: number;
};

/** Inpainting / 多参考图编辑请求：multipart 上传，调上游 /v1/images/edits
 *  imageBlobs[0] 与 maskBlob 对齐（mask 只作用于第 1 张）；其余张作为额外参考 */
export type EditRequest = {
  imageBlobs: Blob[];
  maskBlob: Blob;
  prompt: string;
  size?: string;
  quality?: string;
  n?: number;
  /** "auto" | "opaque" | "transparent"（透明 PNG，AI 抠图用） */
  background?: string;
};

/** 调后端 /api/images/edit，返回新生成的 GenerateResponse */
export async function editImage(req: EditRequest): Promise<GenerateResponse> {
  const form = new FormData();
  if (req.imageBlobs.length === 0) {
    throw new GenerateError({ code: "validation_error", message: "至少需要 1 张参考图" });
  }
  req.imageBlobs.forEach((b, i) => form.append("image", b, `image-${i}.png`));
  form.append("mask", req.maskBlob, "mask.png");
  form.append("prompt", req.prompt);
  if (req.size) form.append("size", req.size);
  if (req.quality) form.append("quality", req.quality);
  if (req.n != null) form.append("n", String(req.n));
  if (req.background) form.append("background", req.background);

  const res = await fetch("/api/images/edit", { method: "POST", body: form });
  if (!res.ok) {
    let apiError: ApiError = { code: "http_error", message: `HTTP ${res.status}` };
    try {
      const j = await res.json();
      if (j.error) apiError = j.error;
    } catch {
      /* 忽略 */
    }
    throw new GenerateError(apiError);
  }
  return (await res.json()) as GenerateResponse;
}

/**
 * 调后端笔刷抠图（MobileSAM mask-prompt）：用户涂粗略区，模型沿真实主体边缘精化。
 * 返回与原图同尺寸的 RGBA PNG（alpha 为精细 mask），便于前端原位叠加做 PSD 分层。
 */
export async function brushCutout(req: {
  imageBlob: Blob;
  maskBlob: Blob;
  subjectType?: "auto" | "object" | "text";
}): Promise<Blob> {
  const form = new FormData();
  form.append("image", req.imageBlob, "image.png");
  form.append("mask", req.maskBlob, "mask.png");
  if (req.subjectType) form.append("subject_type", req.subjectType);
  const res = await fetch("/api/images/brush-cutout", { method: "POST", body: form });
  if (!res.ok) {
    let apiError: ApiError = { code: "http_error", message: `HTTP ${res.status}` };
    try {
      const j = await res.json();
      if (j.error) apiError = j.error;
    } catch {
      /* 忽略 */
    }
    throw new GenerateError(apiError);
  }
  return await res.blob();
}

/** 调后端 rembg 抠图，返回带透明背景的 PNG Blob */
export async function segmentImage(req: SegmentRequest): Promise<Blob> {
  const res = await fetch("/api/images/segment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    let apiError: ApiError = { code: "http_error", message: `HTTP ${res.status}` };
    try {
      const j = await res.json();
      if (j.error) apiError = j.error;
    } catch {
      /* 忽略 */
    }
    throw new GenerateError(apiError);
  }
  return await res.blob();
}
