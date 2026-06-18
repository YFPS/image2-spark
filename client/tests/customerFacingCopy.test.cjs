const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("../node_modules/typescript");

const adminPageSource = fs.readFileSync(
  path.resolve(__dirname, "../src/pages/AdminPage.tsx"),
  "utf8",
);
const appSource = fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf8");
const aiCutoutSource = fs.readFileSync(
  path.resolve(__dirname, "../src/components/AiCutoutModal.tsx"),
  "utf8",
);

function loadTsModule(relativePath, stubs = {}) {
  const absPath = path.resolve(__dirname, "..", relativePath);
  const source = fs.readFileSync(absPath, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const mod = { exports: {} };
  const localRequire = (id) => {
    if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
    return require(id);
  };
  new Function("require", "module", "exports", js)(localRequire, mod, mod.exports);
  return mod.exports;
}

test("管理后台客户可见文案不暴露工程词", () => {
  assert.doesNotMatch(adminPageSource, />[^<]*上游[^<]*</);
  assert.doesNotMatch(adminPageSource, /"[^"]*上游[^"]*"/);
  assert.doesNotMatch(adminPageSource, /API\s*Key/i);
  assert.doesNotMatch(adminPageSource, /\bKey:/);
  assert.doesNotMatch(adminPageSource, /Base\s*URL/i);
});

test("前端错误提示不拼接工程错误码", () => {
  assert.doesNotMatch(appSource, /apiError\.code\}：/);
  assert.doesNotMatch(aiCutoutSource, /apiError\.code\}：/);
});

test("客户错误提示会隐藏内部服务词", () => {
  const { customerErrorMessage } = loadTsModule("src/api/gptImage.ts", {
    "./auth": { authFetch: () => { throw new Error("not used"); } },
    "./conversations": {},
  });

  assert.equal(
    customerErrorMessage({
      code: "upstream_error",
      message: "upstream_error: OPENAI_API_KEY missing",
    }),
    "生成服务暂时不可用，请稍后再试",
  );
  assert.equal(
    customerErrorMessage({
      code: "image_fetch_failed",
      message: "拉取图片失败：connect failed",
    }),
    "图片加载失败，请稍后重试",
  );
  assert.equal(
    customerErrorMessage({
      code: "validation_error",
      message: "图片文件名无效",
    }),
    "图片文件名无效",
  );
});
