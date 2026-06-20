import type { ImageModelItem } from "../api/gptImage";
import type { Featured, Recommend } from "./types";
import featuredGpt from "../assets/plaza/featured-gpt-image2.webp";

export const FILTERS = ["全部", "可用", "未启用"] as const;
export type FilterValue = (typeof FILTERS)[number];

export const TOTAL_PAGES = 1;

export type ModelPageStats = {
  enabledModels: number;
  defaultModel: string;
  status: string;
  capabilities: string;
};

export const MODEL_PAGE_STATS: ModelPageStats = {
  enabledModels: 0,
  defaultModel: "-",
  status: "未启用",
  capabilities: "文生图",
};

export function sortImageModelsForDisplay(models: ImageModelItem[]): ImageModelItem[] {
  return [...models].sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    return a.cost_per_image - b.cost_per_image;
  });
}

export function buildModelPageStats(models: ImageModelItem[]): ModelPageStats {
  const enabled = models.filter((model) => model.available);
  const supportsEdit = enabled.some((model) => model.supports_edit);
  return {
    enabledModels: enabled.length,
    defaultModel: enabled[0]?.label ?? "-",
    status: enabled.length > 0 ? "可用" : "未启用",
    capabilities: supportsEdit ? "文生图 / 图生图" : "文生图",
  };
}

export function imageModelToFeatured(model: ImageModelItem, index: number): Featured {
  const statusLabel = model.available ? "可用" : "未启用";
  return {
    id: model.id,
    title: model.label,
    chip: { label: statusLabel, color: model.available ? model.accent : "rgba(255,255,255,0.42)" },
    desc: model.description,
    stats: {
      hot: `${model.cost_per_image} 积分/张`,
      fav: statusLabel,
      calls: model.supports_edit ? "图生图" : "文生图",
      speed: model.supports_reasoning ? "思考" : "快速",
    },
    featured: index === 0 && model.available,
    badge: `${model.cost_per_image} 积分/张`,
    image: model.id === "image2" ? featuredGpt : undefined,
    fallbackBg: modelFallbackBg(model),
  };
}

export function imageModelToRecommend(model: ImageModelItem): Recommend {
  const statusLabel = model.available ? "可用" : "未启用";
  return {
    id: model.id,
    title: model.label,
    chip: { label: statusLabel, color: model.available ? model.accent : "rgba(255,255,255,0.42)" },
    desc: model.description,
    hot: `${model.cost_per_image} 积分`,
    speed: model.supports_edit ? "图生图" : "文生图",
    image: model.id === "image2" ? featuredGpt : undefined,
    fallbackBg: modelFallbackBg(model),
  };
}

function modelFallbackBg(model: ImageModelItem): string {
  const accent = hexToRgb(model.accent) ?? { r: 215, g: 255, b: 0 };
  return [
    `radial-gradient(120% 90% at 70% 35%, rgba(${accent.r},${accent.g},${accent.b},0.34) 0%, rgba(24,26,31,0.88) 42%, #07090c 78%)`,
    `radial-gradient(70% 90% at 20% 82%, rgba(${accent.r},${accent.g},${accent.b},0.18), transparent 65%)`,
    "linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.01))",
  ].join(",");
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const value = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}
