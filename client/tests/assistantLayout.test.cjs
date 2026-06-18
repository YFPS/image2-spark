const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appSource = fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf8");
const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"),
);

test("AI 助手静态外层保持完整高度并允许内部滚动收缩", () => {
  const dockMatch = appSource.match(/ref=\{assistantDockRef\}[\s\S]*?className="([^"]+)"/);
  assert.ok(dockMatch, "未找到 AI 助手静态外层容器");
  const dockClass = dockMatch[1];

  assert.match(dockClass, /\bh-full\b/);
  assert.match(dockClass, /\bmin-h-0\b/);
  assert.match(dockClass, /\boverflow-hidden\b/);
});

test("AI 助手面板自身保持完整高度并允许消息区滚动", () => {
  const panelMatch = appSource.match(/ref=\{chatPanelRef\}[\s\S]*?className="([^"]+)"/);
  assert.ok(panelMatch, "未找到 AI 助手面板");
  const panelClass = panelMatch[1];

  assert.match(panelClass, /\bh-full\b/);
  assert.match(panelClass, /\bmin-h-0\b/);
  assert.match(panelClass, /\boverflow-hidden\b/);
});

test("AI 助手显示条件变化后会重新测量玻璃布局", () => {
  assert.match(
    appSource,
    /\}, \[activeNav, sidebarExpanded, assistantShouldShow\]\);/,
    "玻璃布局测量 effect 必须依赖 assistantShouldShow",
  );
});

test("PC Web 下历史 tick 条保持在 AI 助手液态卡片外", () => {
  const studioRefsMatch = appSource.match(
    /activeNav === "studio"\s*\?\s*\[([\s\S]*?)\]\s*:\s*activeNav === "models"/,
  );
  assert.ok(studioRefsMatch, "未找到 studio 页面的玻璃测量 refs");
  const studioRefs = studioRefsMatch[1];

  assert.match(
    studioRefs,
    /\bchatPanelRef\b/,
    "AI 助手的液态玻璃 shape 只能测量 chatPanelRef，即 AI 面板本体",
  );
  assert.doesNotMatch(
    studioRefs,
    /\bassistantDockRef\b/,
    "assistantDockRef 包含 TimelineQuickJump，测它会把历史 tick 条包进 AI 助手液态卡片",
  );
});

test("AI 助手卡片不再引入或注册 GSAP 动画", () => {
  assert.doesNotMatch(appSource, /from "gsap"/);
  assert.doesNotMatch(appSource, /from "@gsap\/react"/);
  assert.doesNotMatch(appSource, /\buseGSAP\b/);
  assert.doesNotMatch(appSource, /\bgsap\./);
  assert.equal(packageJson.dependencies?.gsap, undefined);
  assert.equal(packageJson.dependencies?.["@gsap/react"], undefined);
});

test("AI 助手 dock 使用响应式宽度，避免固定宽度挤压主工作区", () => {
  const dockMatch = appSource.match(/ref=\{assistantDockRef\}[\s\S]*?className="([^"]+)"/);
  assert.ok(dockMatch, "未找到 AI 助手 dock 容器");
  assert.match(dockMatch[1], /\bw-\[clamp\(/);

  const panelMatch = appSource.match(/ref=\{chatPanelRef\}[\s\S]*?className="([^"]+)"/);
  assert.ok(panelMatch, "未找到 AI 助手面板");
  assert.match(panelMatch[1], /\bmin-w-0\b/);
  assert.match(panelMatch[1], /\bflex-1\b/);
  assert.doesNotMatch(
    appSource,
    /ref=\{chatPanelRef\}[\s\S]*?style=\{\{\s*width:\s*340\s*\}\}/,
    "AI 助手面板不应再使用 340px 固定内联宽度",
  );
});

test("结果卡操作按钮不会因 AI 助手占宽被压成竖排", () => {
  const actionButtons = Array.from(
    appSource.matchAll(
      /<button[\s\S]*?disabled=\{!results\.length\}[\s\S]*?className="([^"]+)"[\s\S]*?>\s*(下载|分享)\s*<\/button>/g,
    ),
  );
  assert.equal(actionButtons.length, 2, "应找到结果卡的下载和分享按钮");

  for (const [, className, label] of actionButtons) {
    assert.match(className, /\bshrink-0\b/, `${label} 按钮需要保持固定宽度`);
    assert.match(className, /\bwhitespace-nowrap\b/, `${label} 按钮文字不能换行成竖排`);
  }
});
