const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function loadTsModule(relativePath) {
  const filePath = path.resolve(__dirname, "..", relativePath);
  const source = fs.readFileSync(filePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const mod = { exports: {} };
  const fn = new Function("exports", "require", "module", "__filename", "__dirname", output);
  fn(mod.exports, require, mod, filePath, path.dirname(filePath));
  return mod.exports;
}

const { shouldShowAiAssistant } = loadTsModule("src/navigationVisibility.ts");

test("AI 助手只在 studio 工作台显示", () => {
  assert.equal(shouldShowAiAssistant("studio"), true);
  assert.equal(shouldShowAiAssistant("models"), false);
  assert.equal(shouldShowAiAssistant("gallery"), false);
  assert.equal(shouldShowAiAssistant("logs"), false);
  assert.equal(shouldShowAiAssistant("admin"), false);
});

test("相似但不是 studio 的导航 key 不会误显示 AI 助手", () => {
  assert.equal(shouldShowAiAssistant("studio-preview"), false);
  assert.equal(shouldShowAiAssistant("adminish"), false);
});
