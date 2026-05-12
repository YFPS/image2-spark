# 后端 + 前后端联调设计 — gpt-image-2 出图最小闭环

- **日期**：2026-05-12
- **范围**：
  - 后端 FastAPI 新增 `/api/images/generate` 路由，代理至 OpenAI 兼容上游
  - 前端 `client/src/api/gptImage.ts` 封装调用，"生成"按钮接通，Results 卡渲染真实图，loading / error 三态完整
- **不在范围**：
  - /edits 端点（参考图 + mask）
  - 流式 SSE（`stream: true` + partial_images 推流）
  - 用户登录 / 多租户 key 管理
  - 历史记录持久化

---

## 一、架构

```
┌─────────────────┐    fetch JSON     ┌──────────────────┐    HTTPS    ┌────────────────────┐
│ React + Vite    │ ────────────────▶ │ FastAPI (server) │ ──────────▶ │ OpenAI 兼容上游     │
│ (client:5173)   │ ◀──────────────── │ (8000)           │ ◀────────── │ clawopen.top       │
└─────────────────┘   JSON {url/b64}  └──────────────────┘  JSON       └────────────────────┘
```

后端原因：
1. 不暴露 API Key 给浏览器
2. 统一做参数校验、`×→x` 等映射
3. 后续接 SSE / 鉴权时入口集中

---

## 二、环境变量（`server/.env`）

| 变量 | 示例 | 说明 |
|---|---|---|
| `OPENAI_API_KEY` | `sk-...` | 上游鉴权 token |
| `OPENAI_BASE_URL` | `https://api.clawopen.top/v1` | 上游 OpenAI 兼容 base，**必须含 `/v1`**，无尾斜杠。后端拼接 `${BASE_URL}/images/generations` |
| `OPENAI_TIMEOUT` | `120` | 单次请求超时秒（默认 120s） |
| `UPSTREAM_MODEL_OVERRIDE` | `gpt-image-2-vip-4k` | 可选。中转商若使用变体名（如 `gpt-image-2-vip-4k / -flatfee / -usage`），后端在 payload 提交前用此值替换前端传入的 `model`。留空则透传 |

`.env` 已在 `.gitignore` 内，绝不入库。同时新增 `server/.env.example` 供他人参考。

---

## 三、后端 API

### 3.1 `POST /api/images/generate`

**Request body** (`application/json`)：

```json
{
  "prompt": "string, required",
  "model": "gpt-image-2",
  "size": "auto | 1024x1024 | ... | custom WxH",
  "quality": "auto|low|medium|high",
  "n": 1,
  "background": "auto|opaque",
  "output_format": "png|jpeg|webp",
  "output_compression": 80,
  "moderation": "auto|low"
}
```

校验：
- `prompt` 非空
- `n` 在 [1, 10]
- `size` 在前端已校验，后端只做透传 + `x` 形式校验（必须 `auto` 或 `WxH` where W,H 都是 16 倍数等等。后端再校验一次以防绕过）
- `output_compression` 仅 jpeg/webp 时透传

**Response 200** (`application/json`)：

```json
{
  "images": [
    {
      "url": "https://...",
      "b64_json": null
    }
  ],
  "usage": {
    "input_tokens": 24,
    "output_tokens": 384,
    "total_tokens": 408
  },
  "model": "gpt-image-2"
}
```

注：上游可能返回 `b64_json` 或 `url`；后端保留两个字段，前端按存在性渲染。

**Response 4xx/5xx**：

```json
{
  "error": {
    "code": "validation_error | upstream_error | timeout | internal",
    "message": "string",
    "upstream_status": 400
  }
}
```

### 3.2 `GET /api/health`

保留已有，无变动。

---

## 四、后端实现要点

### 4.1 依赖

`server/requirements.txt` 新增：
- `httpx==0.27.0`（异步 HTTP 客户端）
- `python-dotenv==1.0.1`（读取 `.env`）
- `pydantic==2.9.2`（自带于 FastAPI，但显式锁版本）

### 4.2 文件结构

```
server/
  .env                  ← 不入库，含 KEY
  .env.example          ← 入库，模板
  requirements.txt
  app/
    __init__.py
    main.py             ← 注册路由 + CORS
    config.py           ← 从 env 加载配置（pydantic-settings 或简单 os.getenv）
    schemas.py          ← Pydantic 模型
    routers/
      images.py         ← /api/images/generate
    openai_client.py    ← httpx 调上游的薄封装
```

### 4.3 `× → x` 映射

前端 UI 用 `1024×1024`（中文全角 ×），上游 API 要 `1024x1024`（拉丁 x）。

- 前端 `normalizeSize` 在 `generateImages` 调用前已经做了 `×` → `x` 替换
- 后端 `schemas.py` 的 `field_validator("size")` 再做一次替换 + 校验，做双保险

### 4.4 模型名映射（中转商兼容）

中转商可能将上游模型命名为 `gpt-image-2-vip-4k` / `gpt-image-2-flatfee` 等变体。

为保持前端代码干净（始终提交 `gpt-image-2`），后端 `routers/images.py` 在拼装上游 payload 前读取 `UPSTREAM_MODEL_OVERRIDE`：

```python
upstream_model = settings.upstream_model_override or req.model
payload["model"] = upstream_model
```

不带 override 时透传前端值。

### 4.5 错误处理

| 上游情况 | 后端响应 |
|---|---|
| 上游 4xx | 透传 status，body 包成 `{error: {code: "upstream_error", message: ..., upstream_status: 400}}` |
| 上游超时 | 504 + `{error: {code: "timeout", ...}}` |
| 上游 5xx 或网络异常 | 502 + `{error: {code: "upstream_error", ...}}` |
| Pydantic 校验失败 | 422（FastAPI 默认）|
| 自定义校验失败 | 400 + `{error: {code: "validation_error", ...}}` |

### 4.6 安全

- API Key 永远不返回给前端
- 不记录 prompt 全文到日志（截断 200 字符）
- CORS 只放 `http://localhost:5173` 与 `http://127.0.0.1:5173`

---

## 五、前端改动

### 5.1 `client/src/api/gptImage.ts`（新文件）

```typescript
export type GenerateRequest = {
  prompt: string;
  size: string;       // "auto" | "WxH"
  quality: string;
  n: number;
  background: string;
  output_format: string;
  output_compression?: number;
  moderation: string;
};

export type GenerateImage = { url: string | null; b64_json: string | null };
export type GenerateResponse = {
  images: GenerateImage[];
  usage: { input_tokens: number; output_tokens: number; total_tokens: number };
  model: string;
};

export type ApiError = { code: string; message: string; upstream_status?: number };

export async function generateImages(req: GenerateRequest): Promise<GenerateResponse>;
```

错误：所有非 200 抛 `Error`，其上挂 `.apiError: ApiError`。

### 5.2 SimpleGenerateView 改动

- 新增 state：
  - `loading: boolean`
  - `errorMsg: string | null`
  - `results: GenerateImage[]`（替代 mock）
  - `usage: { input_tokens, output_tokens, total_tokens } | null`
- 新增 `prompt: string` state（提示词暂时来自一个隐藏的固定值，或加一个可见的 prompt 输入区。**本次为最小闭环，复用 AI 助手对话面板**：用户在右侧 AI 助手输入框打回车 → 触发生成。同时保留一个隐式默认 prompt）
- "生成"按钮（在顶部 TopBar 内的 `生成` 胶囊）联通；
  - **由于 TopBar 在父组件不便联通**，本次改为：**在右侧 AI 助手输入框回车 = 生成**，并在结果卡新增一个"重新生成"按钮
- Results：
  - n=1 时 `<img src={results[0].url || `data:image/${format};base64,${b64}`} />`
  - n>1 时同样网格渲染
  - loading 时显示骨架屏 + 中央 spinner
  - error 时 Results 卡灰底中央显示错误简要文字；详细错误同时 push 到 AI 助手对话区作为 ai 气泡
- Metrics chip：用 `usage` 数据替换硬编码

### 5.3 prompt 入口决策

**复用 AI 助手输入框（右侧聊天面板）作为本次出图的 prompt 入口**：
- 用户在 `问问 AI...` 输入框打字 → Enter
- 立即作为 `prompt` 字段发起 `/api/images/generate`
- 同时在聊天面板里 push 一条 user 气泡显示输入内容，ai 气泡显示 "正在生成..."
- 完成后 ai 气泡更新为 "已生成 N 张 / cost $X"
- 错误时 ai 气泡显示错误

这避免了在已经满的左卡再塞一个 prompt textarea，符合用户先前删除底部 Prompt 条的偏好。

### 5.4 Vite 代理

`client/vite.config.ts` 加 proxy：
```ts
server: {
  proxy: {
    "/api": "http://127.0.0.1:8000"
  }
}
```

避免 CORS 麻烦，开发环境前端直接打 `/api/images/generate`。

---

## 六、Payload 组装（前端 → 后端）

`handleGenerate` 内联构造 payload（不抽 helper，避免增加文件层级）：

```typescript
await generateImages({
  prompt,
  size: (effectiveSize ?? "auto").toString(),  // gptImage.normalizeSize 再做一次 × → x
  quality,
  n: Number(n),
  background,
  output_format: format,
  output_compression: format !== "png" ? compression : undefined,
  moderation,
});
```

注意：
- `effectiveSize` 在 `customSizeError` 非空时为 `null`，前端通过 `canGenerate` 拦截
- `model` 字段由 client 默认填充 `"gpt-image-2"`，后端再按 `UPSTREAM_MODEL_OVERRIDE` 替换

---

## 七、验收清单

- [ ] `server/.env.example` 已入库，`server/.env` 未入库
- [ ] `uvicorn app.main:app --reload --port 8000` 启动成功
- [ ] `curl localhost:8000/api/health` 返回 `{"status":"ok"}`
- [ ] `curl -X POST localhost:8000/api/images/generate -d '{"prompt":"a cat","size":"1024x1024",...}' -H 'Content-Type: application/json'` 真出图
- [ ] 前端在 AI 助手对话框输入文字回车 → 触发生成 → Results 卡显示真实图
- [ ] 加载中：Results 卡显示骨架/spinner，按钮 disable
- [ ] 错误：聊天面板 ai 气泡显示错误，Results 卡显示错误占位
- [ ] Metrics chip 用 usage 真实数据
- [ ] 自定义尺寸非法时阻断提交（前端拦）
- [ ] 浏览器 console 无新增报错

---

## 八、已知限制

- 不做流式 / partial_images（UI 控件保留作为下一阶段）
- 不做 /edits 多图 + mask
- 不做请求并发限流（前端简单 disable 按钮）
- 错误响应没本地化
- prompt 当前最长不在前端做长度限制（API 上限 32000 字符，正常输入不会超）
