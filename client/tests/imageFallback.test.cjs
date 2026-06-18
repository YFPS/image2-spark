const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const recentWorksSource = fs.readFileSync(
  path.resolve(__dirname, "../src/components/RecentWorksCard.tsx"),
  "utf8",
);
const appSource = fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf8");

test("最近作品图片加载失败时显示明确占位，不再隐藏成黑块", () => {
  assert.doesNotMatch(recentWorksSource, /style\.visibility\s*=\s*"hidden"/);
  assert.match(recentWorksSource, /图片加载失败/);
  assert.match(recentWorksSource, /onError=\{\(\)\s*=>\s*setFailed\(true\)\}/);
});

test("AI 聊天气泡生成图加载失败时显示明确占位，不再显示浏览器破图图标", () => {
  assert.match(appSource, /function GeneratedImageThumb/);
  assert.match(appSource, /图片加载失败/);
  assert.match(appSource, /onError=\{\(\)\s*=>\s*setFailed\(true\)\}/);
});
