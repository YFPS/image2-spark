# gpt-image-2 接口对接 — Generate 页 UI 改造设计

- **日期**：2026-05-12
- **范围**：仅前端 Generate 页（`client/src/App.tsx` 中的 `SimpleGenerateView` 及其子组件）
- **目标模型**：OpenAI `gpt-image-2`（本次只暴露此一个模型，简化 UI 条件分支）
- **不在范围**：后端代理实现、API Key 存储、计费/帐户系统、Edit 端点的实际上传/mask 逻辑（仅 UI 槽位预留）

---

## 一、gpt-image-2 接口能力（基于官方 image-generation guide）

### 1.1 端点

| 端点 | 用途 |
|---|---|
| `POST /v1/images/generations` | 文本生图 |
| `POST /v1/images/edits` | 图像编辑（参考图 + 可选 mask） |

### 1.2 通用参数

| 参数 | 类型 | 取值 | 默认 | 备注 |
|---|---|---|---|---|
| `model` | string | `gpt-image-2` | — | 必填 |
| `prompt` | string | 文本 | — | 受 moderation 限制 |
| `size` | string | `auto`、`1024x1024`、`1536x1024`、`1024x1536`、`2048x2048`，或满足约束的任意尺寸 | `auto` | 单边 ≤3840px、16px 倍数、比例 ≤3:1、总像素 655,360–8,294,400。**注意**：API 字面量用 `x`（如 `1024x1024`），UI 显示用 `×`，提交前需做字符映射 |
| `quality` | string | `auto` / `low` / `medium` / `high` | `auto` | 高质量增加延迟与 token |
| `n` | integer | ≥1 | 1 | 无明确上限 |
| `background` | string | `auto` / `opaque` | `auto` | **不支持 `transparent`**（与 gpt-image-1 的差异点） |
| `output_format` | string | `png` / `jpeg` / `webp` | `png` | |
| `output_compression` | int | 0–100 | — | 仅 jpeg/webp 生效 |
| `moderation` | string | `auto` / `low` | `auto` | |
| `stream` | boolean | true / false | false | **gpt-image-2 新增**：流式渐进生成 |
| `partial_images` | int | 0–3 | 0 | **gpt-image-2 新增**：渐进预览张数 |
| `response_format` | string | `b64_json` / `url` | `b64_json` | 前端通常用 `url` |

### 1.3 /edits 额外参数

| 参数 | 类型 | 备注 |
|---|---|---|
| `image` | file 或 file[] | PNG/JPEG/WebP，单文件 ≤50MB，支持多张 |
| `mask` | file | PNG with alpha channel，尺寸与 image 一致 |
| ~`input_fidelity`~ | — | **已废弃**：gpt-image-2 自动高保真，无需此参数（gpt-image-1 才需要） |

### 1.4 与 gpt-image-1 的关键差异

| 项 | gpt-image-1 | gpt-image-2 |
|---|---|---|
| 流式（partial_images） | ❌ 不支持 | ✅ 支持 0–3 张渐进预览 |
| 尺寸 | 仅 3 种固定 | ✅ 任意（含 2048²，约束如上） |
| 透明背景 | ✅ 支持 | ❌ 不支持 |
| 多图输入（edits） | 单图 | ✅ 多图 |
| 高保真输入 | 需 `input_fidelity` 参数 | ✅ 自动 |

### 1.5 限流（IPM，Images-Per-Minute）

| Tier | IPM |
|---|---|
| 1 | 5 |
| 2 | 20 |
| 3 | 50 |
| 4 | 150 |
| 5 | 250 |

---

## 二、当前 UI 与接口的差异

依据当前 `SimpleGenerateView` 的实现：

### 2.1 已对齐 ✅

- Quality 胶囊 `auto/low/medium/high`
- 数量 `1/2/4/6/8/10`（API 允许更高，前端给到 10 作为合理上限）
- Format `png/jpeg/webp` + 压缩率 0–100
- Moderation `auto/low`（高级设置内）
- Reference image 槽 + Mask 槽（UI 占位）

### 2.2 必须修正 ❌

| # | 问题 | 修正 |
|---|---|---|
| F1 | Background 胶囊含 `transparent` | 删除 `transparent`，只保留 `auto / opaque` |
| F2 | Model 字段固定 `gpt-image-1` | Model 字段固定为 `gpt-image-2`（本次不暴露 gpt-image-1 选项） |
| F3 | 比例只有 3 档 | 拆成 比例(7 段) × 分辨率(1K/2K/4K) 两段；并在高级设置加自定义宽 × 高输入 |

### 2.3 必须新增 🚀

| # | 项 | UI 形态 |
|---|---|---|
| A1 | 流式开关 `stream` | 高级设置内 toggle |
| A2 | 渐进预览张数 `partial_images` 0–3 | 流式开启后显示 0–3 分段控件 |

### 2.4 暂不暴露给用户

- `response_format`：默认 `url`，前端写死
- `input_fidelity`：gpt-image-2 不需要
- `image[]` 多张上传、`mask` 实际上传：UI 已留槽，本次改造仍只是占位（实际拖拽/上传逻辑视为下一阶段）

---

## 三、改造方案（按改动单元）

### 改动 1：Background 移除"透明"

- 文件：`client/src/App.tsx`
- 位置：`PillGroup` 实参列表中"背景"那一项
- 改：去掉 `{ value: "transparent", label: "透明" }`
- 默认值仍是 `auto`

### 改动 2：比例 × 分辨率 矩阵 + 自定义尺寸入口

把原本"size 单状态"拆成 **`ratio` + `resolution` 两段控件**，最终 `size` 由矩阵映射得到。覆盖官方"任意尺寸"能力，同时保留 K-resolution 心智模型。

#### 2.1 状态

- `ratio: "auto" | "1:1" | "16:9" | "9:16" | "2:3" | "3:2" | "custom"`，默认 `"1:1"`
- `resolution: "1K" | "2K" | "4K"`，默认 `"1K"`
- `customW`, `customH`（仅 ratio = custom 时使用）

#### 2.2 UI

- **比例**段（7 胶囊）：`自动 / 1:1 / 16:9 / 9:16 / 2:3 / 3:2 / 自定`
- **分辨率**段（3 胶囊）：`1K / 2K / 4K`
  - 当 `ratio = auto` 或 `custom` 时分辨率行整体灰显（pointer-events 禁用 + 透明度降低）

#### 2.3 比例 × 分辨率 映射表

| ratio \ res | 1K | 2K | 4K |
|---|---|---|---|
| 1:1  | 1024×1024 | 2048×2048 | 2880×2880 |
| 16:9 | 1792×1024 | 2048×1152 | 3840×2160 |
| 9:16 | 1024×1792 | 1152×2048 | 2160×3840 |
| 2:3  | 1024×1536 | 1536×2304 | 2304×3456 |
| 3:2  | 1536×1024 | 2304×1536 | 3456×2304 |

每一项均验证：16 倍数 ✓、单边 ≤3840 ✓、总像素 ∈ [655k, 8.3M] ✓、比例 ≤3:1 ✓。

> 注：1:1 的 4K 取 2880×2880（受总像素 8.3M 约束，3840×3840 ≈14.7M 超限）

#### 2.4 自定义

- 选 `自定` 胶囊后自动展开高级设置
- 高级设置内露出"自定义尺寸"块：双数字输入 + 实时校验
- 校验规则（`validateCustomSize`）：
  - 必须是正整数
  - 16 的倍数
  - 单边 ≤ 3840
  - 总像素 ∈ [655,360, 8,294,400]
  - 比例 ≤ 3:1
- 校验失败：输入框红色描边 + 红字提示；Results 副标显示 "无效尺寸"
- 切回非 `custom` 比例时自定义状态保留

### 改动 3：Model 固定为 gpt-image-2

- Model 字段保留显示，但内容写死为 `gpt-image-2`（外观使用单选段控件，单段不可切换或只读 chip）
- 标题副标定为 "借助 AI 创作画面 · gpt-image-2"
- 不再做 gpt-image-1 双模型条件分支（避免 UI 逻辑过度复杂）

### 改动 4：高级设置加 stream + partial_images

- 在高级设置展开区域新增两控件：
  - 流式开关（toggle 按钮，默认 off）
  - 流式开启时显示 `partial_images` 分段：`0 / 1 / 2 / 3`

### 受控状态总览

| 状态 | 类型 | 初值 | 涉及改动 |
|---|---|---|---|
| `model` | string（常量） | `gpt-image-2` | 改 3 |
| `ratio` | string | `1:1` | 改 2 |
| `resolution` | string | `1K` | 改 2 |
| `customW`, `customH` | number | 1024, 1024 | 改 2 |
| `background` | string | `auto` | 改 1（选项收窄） |
| `stream` | boolean | false | 改 4 |
| `partialImages` | string | `0` | 改 4 |

---

## 四、验收标准

- [ ] 浏览器无 console 报错
- [ ] 背景胶囊只有 `自动 / 不透明` 两段
- [ ] 比例胶囊出现 `2K`；点击 `自定义` 在高级设置内可输入宽高，校验逻辑生效
- [ ] Model 字段固定显示 `gpt-image-2`，不可选其它
- [ ] 流式开关 + partial_images 0–3 在高级设置展开后可见
- [ ] 字段值变化反映在右上结果卡的副标
- [ ] 移除"透明"后默认值不会落到不合法值（即 background 不会保留 `transparent`）

---

## 五、风险

| 风险 | 缓解 |
|---|---|
| 自定义尺寸校验规则较多，体验差 | 错误提示直接显示在输入框下方，且实时校验 |
| 旧的状态可能残留 `transparent` 值 | 初始 state 强制为 `auto`；并在 Background 段选项里物理删除 `transparent` 避免被复现 |
| stream + partial_images 涉及后端配合 | 本次仅做前端控件占位，提交请求逻辑放下一阶段 |

## 六、已知限制

- **顶部 TopBar 的"生成"按钮在校验失败时未置灰**：TopBarReplica 是 App 顶层兄弟组件，未与 SimpleGenerateView 共享 customSizeError 状态。本次实现仅在自定义尺寸输入区内联红字提示并把 Results 副标显示为"无效尺寸"，给用户充分反馈但不阻塞点击 TopBar 的"生成"。后续如需阻塞，需要把校验状态提升到 App 层或引入轻量 context。
- **比例胶囊的"自定义"标签** 因 segmented 段宽不足显示为短写"自定"（2 字），完整含义为"自定义"。
- **API 字符串映射**：UI 显示用 `×`，API 字面量用 `x`，本次仅 UI；提交时需在 API client 里做替换。
- **/edits 端点的多张图 + Mask 上传逻辑**：UI 槽位已留，实际拖拽/上传/Mask 渲染留作下一阶段。
