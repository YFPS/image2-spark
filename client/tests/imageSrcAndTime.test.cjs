const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("../node_modules/typescript");

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

test("safeImageSrc keeps same-origin asset image URLs unproxied", () => {
  const { safeImageSrc } = loadTsModule("src/api/gptImage.ts", {
    "./auth": { authFetch: () => { throw new Error("not used"); } },
    "./conversations": {},
  });

  assert.equal(
    safeImageSrc("/api/images/assets/123-0.png"),
    "/api/images/assets/123-0.png",
  );
  assert.equal(
    safeImageSrc("https://cdn.example/a.png"),
    "/api/images/proxy-image?url=https%3A%2F%2Fcdn.example%2Fa.png",
  );
});

test("formatRelativeTime treats naive backend timestamps as local time", () => {
  const { formatRelativeTime } = loadTsModule("src/utils/relativeTime.ts");

  assert.equal(
    formatRelativeTime("2026-06-19T01:50:49", new Date("2026-06-19T02:39:33+08:00")),
    "48 分钟前",
  );
  assert.equal(
    formatRelativeTime("2026-06-18T18:30:00Z", new Date("2026-06-19T02:39:33+08:00")),
    "9 分钟前",
  );
});

test("recent work items must be asset-backed and timestamped", () => {
  const { isAssetBackedRecentWorkItem } = loadTsModule("src/api/gptImage.ts", {
    "./auth": { authFetch: () => { throw new Error("not used"); } },
    "./conversations": {},
  });

  assert.equal(
    isAssetBackedRecentWorkItem({
      message_id: 1,
      conversation_id: 2,
      image_url: "/api/images/assets/1-0.png",
      image_count: 1,
      all_image_urls: ["/api/images/assets/1-0.png"],
      size: null,
      created_at: "2026-06-19T12:00:00Z",
    }),
    true,
  );

  assert.equal(
    isAssetBackedRecentWorkItem({
      message_id: 1,
      conversation_id: 2,
      image_url: "data:image/png;base64,abc",
      image_count: 1,
      all_image_urls: ["data:image/png;base64,abc"],
      size: null,
      created_at: "2026-06-19T12:00:00Z",
    }),
    false,
  );

  assert.equal(
    isAssetBackedRecentWorkItem({
      message_id: 1,
      conversation_id: 2,
      image_url: "/api/images/assets/1-0.png",
      image_count: 1,
      all_image_urls: ["/api/images/assets/1-0.png"],
      size: null,
      created_at: "",
    }),
    false,
  );
});
