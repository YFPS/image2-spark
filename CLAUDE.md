# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

image2 是一个 AI 图像生成 SaaS 的"节点画布编辑器"原型：前端用 React + WebGL 渲染液态玻璃风格的节点工作流，后端用 FastAPI 代理 `gpt-image-2` 文生图 / 图生图（inpainting），并提供本地 ML 抠图与 PSD 导出工具链。

- `client/` — React 18 + Vite + TypeScript + Tailwind，自实现 WebGL2 多通道液态玻璃着色器
- `server/` — FastAPI，封装 OpenAI 兼容上游 + 本地 CV/ML 抠图
- `tools/` — 纯 Python PSD 写出器（与服务无依赖）
- `tests/` — 仓库根 `tools/` 的单测；`server/tests/` 是 server 端单测
- `docs/specs/` — 关键功能的设计稿（gpt-image-2 接入、inpainting、抠图后端、贴纸裁剪等），改动这些功能前应先读对应 spec
- `DESIGN.md` — 节点画布的视觉与交互铁律（灰阶 UI、端口语义色、电黄唯一 CTA）

## 常用命令

### 前端（`client/`）

```bash
npm install
npm run dev        # vite 起在 5173；后端 CORS 已 allowlist 5173
npm run build      # tsc -b && vite build
npm run preview
```

无 lint / test 脚本。Tailwind 通过 `tailwind.config.js` + PostCSS 接入。

### 后端（`server/`）

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000     # 固定 8000，不要换端口（见下）
```

### 测试

仓库根的 `tools/` 单测从仓库根运行：

```bash
python -m unittest tests.test_psd_writer            # 全部
python -m unittest tests.test_psd_writer.PsdWriterTests.test_writes_layered_rgb_psd_that_pillow_can_open
```

server 单测在 `server/` 目录下运行（用 `from app import ...`）：

```bash
cd server
python -m unittest tests.test_segment_service
```

## 后端端口规则

后端固定 8000。被占用时**杀掉占用进程**而非换端口（前端 `client/src/api/gptImage.ts` 默认指向 `http://127.0.0.1:8000`）。

```powershell
Get-NetTCPConnection -LocalPort 8000 | Select-Object -Expand OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }
```

## 后端架构要点

`server/app/main.py` 极薄：只装 CORS + 挂 `routers/images.py`。所有业务在 `routers/images.py`，由四个职责清晰的模块支撑：

- `config.py` — 从 `server/.env` 读取所有运行时配置（`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`UPSTREAM_MODEL_OVERRIDE` / `_4K`、`SEGMENT_BACKEND`、SAM/MobileSAM 权重路径等）。`get_settings()` 用 `lru_cache` 单例化。
- `openai_client.py` — 透传到上游 `/v1/images/generations` 与 `/v1/images/edits` 的 httpx 客户端，统一抛 `UpstreamError` / `UpstreamTimeout`。
- `schemas.py` — Pydantic 请求/响应模型。`GenerateRequest.size` 的校验规则较严（16 的倍数、单边 ≤3840、总像素 655360–8294400、宽高比 ≤3:1，允许全角 `×`）；新增字段时这里是真相源。
- `segment_service.py` — ML 抠图。后端可由 env `SEGMENT_BACKEND` 切换：`grabcut`（默认，OpenCV GrabCut + 用户矩形 prompt，复杂海报场景）/ `rembg`（v1 显著性分割）/ `sam` / `mobile_sam`。所有模型 session/predictor 都是**懒加载单例**——不要在 import 期加载，启动路径必须保持轻。CPU 密集推理在路由里用 `asyncio.to_thread` 推到线程池。

### 路由约定（`/api/images/*`）

- `POST /generate` — 文生图。**模型路由策略**：若请求 size 单边 > 2048，使用 `UPSTREAM_MODEL_OVERRIDE_4K`，否则用 `UPSTREAM_MODEL_OVERRIDE`，再否则透传前端 `model`。中转商常用 `gpt-image-2-vip` / `-vip-4k` 这类变体名，所以这层 override 不要丢。
- `POST /edit` — Inpainting（multipart：`image`、`mask`、`prompt`、`size`、…）。**复用 `/generate` 同一套 4K 模型路由策略**——改一处时两处同步改。
- `POST /segment` — 给定 `url + x,y,w,h + padding_factor`，返回紧凑 bbox 的透明 PNG。
- `GET /proxy-image?url=` — 反代上游 CDN 图片，规避前端 canvas 跨域 taint。强约束：仅 https、Content-Type 必须 `image/*`、单文件 ≤ 50 MB。

错误返回统一形如 `{"error": {"code", "message", "upstream_status"?}}`。新增路由时沿用同一形状。

## 前端架构要点

`client/src/App.tsx` 是整个应用的主入口，包含全部节点画布逻辑（单文件 SPA 形态，~1k+ 行）。关键模式：

- **节点 = 单一真相源**：每个节点声明自己的 `ports`（side/top/color），连线从节点声明读端口位置，因此节点内部布局调整不会让连线错位。改节点尺寸时优先调整 `NODE_W / *_CARD_H` 常量，不要硬编码端口坐标。
- **WebGL 液态玻璃**：`LiquidGlass.tsx` + `shaders/*.glsl`（多通道：背景两次高斯模糊 + 主 pass 折射/色散/菲涅尔反射）。这是真正的光学玻璃（折射背景），不是 `backdrop-filter`。`GlassControls.tsx` 暴露调参面板，参数会 `localStorage` 持久化。详细规范见 `webgl-liquid-glass` skill。
- **API 层** `src/api/gptImage.ts` 是后端契约的 TS 镜像。修改后端 `schemas.py` 时这里要同步。
- **设计铁律**（`DESIGN.md`）：UI 灰阶；颜色全部让给语义（端口数据类型色）；唯一发光是 Generate 电黄胶囊；节点是 14px 圆角 + 半透明深玻璃。新增 UI 元素前对照 DESIGN.md。

## 写代码时的语言规则

所有新增/修改的代码注释、commit message、面向用户的回复都用**简体中文**。已有的英文注释除非被你重写否则保持原样。

## 相关 skill

- `webgl-liquid-glass` — 液态玻璃着色器的完整规范与移植参考（修改 `shaders/*.glsl` 或 `LiquidGlass.tsx` 前阅读）
- `liquid-glass-design` — iOS 26 液态玻璃设计系统（视觉参考，非代码）
- `frontend-design` — 构建前端组件/页面时的设计指引
- `deploy` — 部署到腾讯云服务器
- `qpush` — 快速 commit + push
