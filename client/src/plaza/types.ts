// 模型广场卡片相关类型定义。
// chip：分类标签的颜色锚点；fallbackBg：图片缺失或加载失败时的兜底渐变。

export type Chip = { label: string; color: string };

export type Featured = {
  id: string;
  title: string;
  chip: Chip;
  desc: string;
  stats: { hot: string; fav: string; calls?: string; speed: string };
  /** 本地 webp 经 Vite import 后的字符串路径；undefined 时走 fallbackBg */
  image?: string;
  /** 缺图或加载失败时的 CSS 渐变 */
  fallbackBg: string;
  featured?: boolean;
  badge?: string;
};

export type Recommend = {
  id: string;
  title: string;
  chip: Chip;
  desc: string;
  hot: string;
  speed: string;
  image?: string;
  fallbackBg: string;
};
