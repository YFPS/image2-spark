const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const adminPageSource = fs.readFileSync(
  path.resolve(__dirname, "../src/pages/AdminPage.tsx"),
  "utf8",
);
const adminApiSource = fs.readFileSync(
  path.resolve(__dirname, "../src/api/admin.ts"),
  "utf8",
);

test("管理后台包含用户数据可视化入口", () => {
  assert.match(adminPageSource, /label:\s*"用户数据"/);
  assert.match(adminPageSource, /UserDataPanel/);
  assert.match(adminPageSource, /UserDataCard/);
});

test("用户数据面板覆盖关键业务数据源", () => {
  for (const table of [
    "conversations",
    "messages",
    "credit_transactions",
    "email_verification_tokens",
    "generated_assets",
  ]) {
    assert.match(adminPageSource, new RegExp(table));
  }
});

test("前端 admin API 提供带用户摘要的数据读取函数", () => {
  assert.match(adminApiSource, /getAdminDataTable/);
  assert.match(adminApiSource, /AdminDataTablePage/);
  assert.match(adminApiSource, /AdminUserSummary/);
  assert.match(adminApiSource, /_user/);
});

test("用户数据界面不再直接显示数据表英文名称", () => {
  assert.doesNotMatch(adminPageSource, />\{t\.key\}<\/span>/);
  assert.doesNotMatch(adminPageSource, /\{table\} ·/);
  assert.match(adminPageSource, /FIELD_LABELS/);
  assert.match(adminPageSource, /fieldLabel/);
});

test("用户数据详情提供对话历史阅读器", () => {
  assert.match(adminPageSource, /UserConversationReader/);
  assert.match(adminPageSource, /ConversationHistoryList/);
  assert.match(adminPageSource, /ConversationTimeline/);
  assert.match(adminApiSource, /getAdminUserConversations/);
  assert.match(adminApiSource, /getAdminConversation/);
  assert.match(adminApiSource, /AdminConversationDetail/);
});

test("用户数据详情浮层避开应用顶部导航", () => {
  assert.match(adminPageSource, /top-\[76px\]/);
  assert.doesNotMatch(adminPageSource, /fixed inset-0 z-50 overflow-y-auto/);
});

test("管理员图片页使用生成资产视图", () => {
  assert.match(adminApiSource, /AdminImageAsset/);
  assert.match(adminPageSource, /Paged<AdminImageAsset>/);
  assert.match(adminPageSource, /image_url/);
  assert.match(adminPageSource, /资产编号/);
  assert.match(adminPageSource, /只看可用图片/);
  assert.doesNotMatch(adminPageSource, /Paged<\{ id: number; conversation_id: number; user_id: number \| null; image_urls/);
});
