import type { Featured, Recommend } from "./types";

// 8 张模型海报 webp，由 server/scripts/gen_plaza_posters.py 用项目生图接口生成
import featuredGpt from "../assets/plaza/featured-gpt-image2.webp";
import featuredBanana from "../assets/plaza/featured-banana.webp";
import featuredNano from "../assets/plaza/featured-nano.webp";
import featuredPro from "../assets/plaza/featured-pro.webp";
import recVision from "../assets/plaza/rec-vision-xl.webp";
import recDreamer from "../assets/plaza/rec-dreamer.webp";
import recChat from "../assets/plaza/rec-chat-master.webp";
import recMulti from "../assets/plaza/rec-multi-modal.webp";

// 模型广场 mock 数据。

export const FILTERS = ["全部", "图像生成", "对话模型", "多模态", "专业版"] as const;
export type FilterValue = (typeof FILTERS)[number];

export const TOTAL_PAGES = 5;

export const FEATURED: Featured[] = [
  {
    id: "gpt-image2",
    title: "GPT IMAGE2",
    chip: { label: "图像生成", color: "#4CB1FF" },
    desc: "新一代图像生成模型，细节出众，创意无限。",
    stats: { hot: "98.7K", fav: "23.6K", calls: "1.2M", speed: "1.2s" },
    featured: true,
    badge: "旗舰模型",
    image: featuredGpt,
    fallbackBg:
      "radial-gradient(120% 90% at 70% 35%, #6b3bd6 0%, #2a164d 35%, #050310 75%)," +
      "radial-gradient(60% 80% at 25% 80%, rgba(99,102,241,0.45), transparent 65%)",
  },
  {
    id: "banana",
    title: "BANANA",
    chip: { label: "对话模型", color: "#7CE38B" },
    desc: "轻松有趣的对话体验，\n你的创意好伙伴。",
    stats: { hot: "68.4K", fav: "12.1K", speed: "0.8s" },
    image: featuredBanana,
    fallbackBg:
      "radial-gradient(110% 90% at 75% 30%, #f7c948 0%, #6c4413 40%, #0b0708 80%)," +
      "radial-gradient(60% 80% at 25% 80%, rgba(247,176,91,0.30), transparent 65%)",
  },
  {
    id: "nano",
    title: "NANO",
    chip: { label: "高速模型", color: "#7CE38B" },
    desc: "超快响应，低延迟输出，\n适合高频创作场景。",
    stats: { hot: "41.2K", fav: "8.7K", speed: "0.3s" },
    image: featuredNano,
    fallbackBg:
      "radial-gradient(110% 90% at 70% 35%, #1e90ff 0%, #142a55 40%, #06070d 80%)," +
      "radial-gradient(60% 80% at 25% 85%, rgba(99,179,255,0.30), transparent 65%)",
  },
  {
    id: "pro",
    title: "PRO",
    chip: { label: "专业版", color: "rgba(255,255,255,0.55)" },
    desc: "专业级创作模型，\n满足高标准输出需求。",
    stats: { hot: "32.8K", fav: "6.3K", speed: "1.6s" },
    image: featuredPro,
    fallbackBg:
      "radial-gradient(110% 90% at 70% 30%, #b1b5bf 0%, #3b3d49 45%, #0a0a10 80%)," +
      "radial-gradient(60% 80% at 25% 85%, rgba(160,170,200,0.25), transparent 65%)",
  },
];

export const RECOMMEND: Recommend[] = [
  {
    id: "vision-xl",
    title: "VISION XL",
    chip: { label: "图像生成", color: "#4CB1FF" },
    desc: "超清图像生成，支持复杂场景渲染。",
    hot: "28.1K",
    speed: "1.4s",
    image: recVision,
    fallbackBg: "linear-gradient(135deg,#2a5b8e 0%,#0f1f33 60%,#070a13 100%)",
  },
  {
    id: "dreamer",
    title: "DREAMER",
    chip: { label: "图像生成", color: "#4CB1FF" },
    desc: "艺术风格多样，激发无限想象。",
    hot: "19.7K",
    speed: "1.8s",
    image: recDreamer,
    fallbackBg: "linear-gradient(135deg,#7a4cb7 0%,#2a1748 60%,#0a0612 100%)",
  },
  {
    id: "chat-master",
    title: "CHAT MASTER",
    chip: { label: "对话模型", color: "#7CE38B" },
    desc: "强大对话理解，精准回答各类问题。",
    hot: "17.3K",
    speed: "0.7s",
    image: recChat,
    fallbackBg: "linear-gradient(135deg,#1f8e8e 0%,#0e2a3c 60%,#06121a 100%)",
  },
  {
    id: "multi-modal",
    title: "MULTI MODAL",
    chip: { label: "多模态", color: "#FF7E87" },
    desc: "文本、图像、语音多模态理解。",
    hot: "15.6K",
    speed: "1.1s",
    image: recMulti,
    fallbackBg: "linear-gradient(135deg,#a44ad6 0%,#3b1755 60%,#0c0716 100%)",
  },
];
