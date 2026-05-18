# 动效背景实现计划（v2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `LiquidGlass.tsx` 的静态背景改造为 **5 个游走 + 呼吸发光的光球**（3 色 + 2 白），dot-grid 位置保持静态但亮度受最近光球照亮。

**Architecture:** JS 端按 Lissajous 轨迹算每球位置（双正弦内积），按 sin 算每球呼吸亮度，每帧推 4 个数组 uniform；shader 端循环 5 次做距离衰减 + 颜色累加。

**Tech Stack:** WebGL2 fragment shader（GLSL 300 es）、React 18 + TS、Vite。无新依赖。

**Reference spec:** `docs/specs/2026-05-19-animated-background-design.md` (v2)

**已完成的前置工作 (commit `9072392`):** `u_time` / `u_motionScale` uniform、`startedAt` 时间戳、`prefers-reduced-motion` MediaQueryList 监听都已就位；shader 末尾有临时 1Hz 呼吸，在 Task 2 会被删除。

**Verification strategy:** 每个 task 通过 `npm run build` + `npm run dev` 启动 + 浏览器肉眼对照 spec § 9 验收。Task 4 用 chrome-devtools MCP 做性能 trace。

---

## 文件结构

| 路径 | 操作 | 职责 |
|---|---|---|
| `client/src/LiquidGlass.tsx` | 修改 | 添加 `LIGHT_BALLS` 配置常量、Flat 数组预分配、每帧 Lissajous 计算与 4 个数组 uniform 推送 |
| `client/src/shaders/fragment-bg.glsl` | 修改 | 新增 `u_lightCount` / `u_lightPositions[5]` / `u_lightIntensities[5]` / `u_lightColors[5]` / `u_lightRadii[5]` uniforms；用循环替换 3 段固定色团；dot-grid 添加 boost loop；删除 TEMP 临时呼吸 |

无新增文件。无第三方依赖变化。

---

## Task 2：实现 5 个游走 + 呼吸光球

> 目标：删除 Task 1 临时呼吸，把 5 个 Lissajous 轨迹光球完整接上。**dot-grid 在本 task 中保持原样**（规则方阵 + 0.06 静态亮度）——下个 task 才让点阵被光球照亮。这样可以分离验证"球渲染对了"和"点阵反射对了"两件事。

**Files:**
- Modify: `client/src/LiquidGlass.tsx`（顶部加常量、effect 内加预分配 + 计算 + 推送）
- Modify: `client/src/shaders/fragment-bg.glsl`（加 uniforms、替换色团段、删除 TEMP）

### 步骤

- [ ] **Step 2.1：在 `LiquidGlass.tsx` 顶部增加 `LIGHT_BALLS` 常量**

修改 `client/src/LiquidGlass.tsx`。找到 `const MAX_SHAPES = 8;` 这一行，在它**下面**追加：

```ts
// 光球数：与 shader 内 MAX_LIGHTS 保持一致
const MAX_LIGHTS = 5;

// 5 个光球的静态属性
//   anchor:        uv 0..1 锚点（屏幕左上 0,0；右下 1,1）
//   color:         线性 RGB 0..1
//   radius:        CSS px（光球柔晕半径，未乘 dpr）
//   phaseX/phaseY: 位置 Lissajous 起始相位（弧度）
//   breathPhase:   亮度呼吸起始相位（弧度）
const LIGHT_BALLS = [
  { anchor: [0.20, 0.30], color: [1.00, 0.31, 0.78], radius: 480, phaseX: 0.0, phaseY: 1.7, breathPhase: 0.0 },
  { anchor: [0.78, 0.22], color: [0.31, 0.71, 1.00], radius: 520, phaseX: 2.1, phaseY: 3.9, breathPhase: 1.3 },
  { anchor: [0.85, 0.70], color: [0.55, 0.39, 1.00], radius: 360, phaseX: 4.3, phaseY: 0.8, breathPhase: 2.7 },
  { anchor: [0.30, 0.78], color: [1.00, 1.00, 1.00], radius: 400, phaseX: 5.5, phaseY: 2.2, breathPhase: 4.1 },
  { anchor: [0.55, 0.50], color: [1.00, 1.00, 1.00], radius: 380, phaseX: 1.0, phaseY: 4.6, breathPhase: 5.5 },
] as const;

// Lissajous 参数（位置）与呼吸参数（亮度）
const POS_FREQ_A = 0.05;       // rad/s
const POS_FREQ_B = 0.037;      // rad/s
const POS_AMP_X = 0.32;        // ±32% 视口宽度
const POS_AMP_Y = 0.28;        // ±28% 视口高度
const BREATH_PERIOD = 12;      // 秒
const BREATH_AMP = 0.35;       // ±35% 基线
```

- [ ] **Step 2.2：在 effect 内预分配 4 个 Flat 数组**

修改 `client/src/LiquidGlass.tsx` 的 `useEffect`。找到现有 shape 相关的预分配区域：

```ts
    const centersFlat = new Array<number>(MAX_SHAPES * 2).fill(0);
    const sizesFlat = new Array<number>(MAX_SHAPES * 2).fill(0);
    const radiiFlat = new Array<number>(MAX_SHAPES).fill(0);
```

在这三行**之后**追加：

```ts
    // 光球 uniform 数组（一次性分配，每帧填值，不创建新数组）
    const lightPosFlat = new Array<number>(MAX_LIGHTS * 2).fill(0);
    const lightIntensityFlat = new Array<number>(MAX_LIGHTS).fill(0);
    const lightColorFlat = new Array<number>(MAX_LIGHTS * 3).fill(0);
    const lightRadiusFlat = new Array<number>(MAX_LIGHTS).fill(0);
```

- [ ] **Step 2.3：在 `render()` 内每帧计算 5 个球**

修改 `LiquidGlass.tsx` 的 `render` 函数。找到现有的：

```ts
      const m = mouseRef.current;
      const mouseGlX = m.x * dpr;
      const mouseGlY = (height - m.y) * dpr;
```

在这三行**之后**追加：

```ts
      // 光球状态：Lissajous 位置 + 正弦呼吸亮度
      const tSec = (performance.now() - startedAt) / 1000;
      const tAnim = tSec * motionScale;   // reduced-motion 时 tAnim≡0，球回到锚点
      for (let i = 0; i < MAX_LIGHTS; i++) {
        const b = LIGHT_BALLS[i];
        const dx = POS_AMP_X * Math.sin(tAnim * POS_FREQ_A + b.phaseX) *
                               Math.cos(tAnim * POS_FREQ_B + b.phaseX * 1.3);
        const dy = POS_AMP_Y * Math.sin(tAnim * POS_FREQ_B + b.phaseY) *
                               Math.cos(tAnim * POS_FREQ_A + b.phaseY * 1.7);
        const px = (b.anchor[0] + dx) * width;
        const py = (b.anchor[1] + dy) * height;
        lightPosFlat[i * 2] = px * dpr;
        lightPosFlat[i * 2 + 1] = (height - py) * dpr;   // DOM → GLSL y 翻转

        const breath = 1 + BREATH_AMP * Math.sin(tAnim * (2 * Math.PI / BREATH_PERIOD) + b.breathPhase);
        lightIntensityFlat[i] = breath;

        lightColorFlat[i * 3] = b.color[0];
        lightColorFlat[i * 3 + 1] = b.color[1];
        lightColorFlat[i * 3 + 2] = b.color[2];

        lightRadiusFlat[i] = b.radius;
      }
```

- [ ] **Step 2.4：在 `setUniforms` 调用里追加 5 个 uniform**

修改 `LiquidGlass.tsx` 的 `setUniforms` 调用，在 `u_motionScale: motionScale,` 这一行**之后**追加：

```ts
        u_lightCount: MAX_LIGHTS,
        u_lightPositions: lightPosFlat,
        u_lightIntensities: lightIntensityFlat,
        u_lightColors: lightColorFlat,
        u_lightRadii: lightRadiusFlat,
```

完整 setUniforms 调用此时形如：

```ts
      renderer.setUniforms({
        u_resolution: [cw, ch],
        u_dpr: dpr,
        u_blurWeights: cachedBlurWeights,
        u_blurRadius: p.blurRadius,
        u_mouse: [mouseGlX, mouseGlY],
        u_shapeRoundness: p.shapeRoundness,
        u_shapeCount: count,
        u_shapeCenters: centersFlat,
        u_shapeSizes: sizesFlat,
        u_shapeRadii: radiiFlat,
        u_time: (performance.now() - startedAt) / 1000,
        u_motionScale: motionScale,
        u_lightCount: MAX_LIGHTS,
        u_lightPositions: lightPosFlat,
        u_lightIntensities: lightIntensityFlat,
        u_lightColors: lightColorFlat,
        u_lightRadii: lightRadiusFlat,
      });
```

- [ ] **Step 2.5：shader 加入光球 uniforms**

修改 `client/src/shaders/fragment-bg.glsl`。找到现有的：

```glsl
#define MAX_SHAPES 8
```

在这一行**下面**追加：

```glsl
#define MAX_LIGHTS 5
```

然后找到现有 shape uniform 声明（`uniform int u_shapeCount;` 那一组）。在那一整组**下面**追加：

```glsl
// 光球数组（JS 端按 Lissajous 算好后上传）
uniform int u_lightCount;
uniform vec2 u_lightPositions[MAX_LIGHTS];   // GLSL 像素坐标（已乘 dpr）
uniform float u_lightIntensities[MAX_LIGHTS]; // 0.65..1.35，呼吸调制后
uniform vec3 u_lightColors[MAX_LIGHTS];       // 线性 RGB 0..1
uniform float u_lightRadii[MAX_LIGHTS];       // CSS px，shader 内乘 u_dpr
```

- [ ] **Step 2.6：shader 替换 3 段固定色团为光球循环**

修改 `fragment-bg.glsl` 的 `calcCanvasBg` 函数。找到现有的三段色团代码：

```glsl
  // top-left magenta blob
  vec2 c1 = vec2(u_resolution.x * 0.25, u_resolution.y * 1.0);
  float d1 = length(fragPx - c1) / (480.0 * u_dpr);
  bg += vec3(1.0, 0.31, 0.78) * 0.25 * smoothstep(1.0, 0.0, d1);
  // bottom-right cyan blob
  vec2 c2 = vec2(u_resolution.x * 0.75, u_resolution.y * 0.0);
  float d2 = length(fragPx - c2) / (520.0 * u_dpr);
  bg += vec3(0.31, 0.71, 1.0) * 0.20 * smoothstep(1.0, 0.0, d2);
  // mid-right violet blob
  vec2 c3 = vec2(u_resolution.x * 0.90, u_resolution.y * 0.66);
  float d3 = length(fragPx - c3) / (360.0 * u_dpr);
  bg += vec3(0.55, 0.39, 1.0) * 0.18 * smoothstep(1.0, 0.0, d3);
```

整段（连同三个 `// xxx blob` 注释）替换为：

```glsl
  // 5 个游走光球：循环计算 falloff + 颜色 × 呼吸强度 累加
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= u_lightCount) break;
    vec2 lpos = u_lightPositions[i];
    float lrad = u_lightRadii[i] * u_dpr;
    float d = length(fragPx - lpos) / lrad;
    float falloff = smoothstep(1.0, 0.0, d);
    bg += u_lightColors[i] * 0.25 * u_lightIntensities[i] * falloff;
  }
```

- [ ] **Step 2.7：删除 Task 1 留下的临时呼吸**

修改 `fragment-bg.glsl` 的 `main()` 函数。删除整块：

```glsl
  // === TEMP wiring 验证：整屏亮度做 1Hz 呼吸 ===
  // sin(t*2π) 周期 1s，振幅 ±2%；u_motionScale=0 时归零
  float breathe = sin(u_time * 6.2831853) * 0.02 * u_motionScale;
  bgColor += vec3(breathe);
  // === TEMP end ===
```

- [ ] **Step 2.8：编译校验**

```bash
cd D:/webProject/image2/client
npm run build
```

Expected: 编译成功，无 TS 错误，无 shader 编译警告。

常见失败原因：
- `MAX_LIGHTS` 在 GLSL 里没定义 → 检查 Step 2.5 的 `#define MAX_LIGHTS 5` 行
- TS 报错 "Cannot find name 'startedAt'" → 检查 commit `9072392` 是否到位
- 数组下标越界 → 看具体行号，检查 `* 3` / `* 2` 步长是否对应 vec3/vec2

- [ ] **Step 2.9：dev server 启动**

检查 5173 是否已被占用：

```powershell
Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue
```

如果占用且不是上次 vite，杀掉：

```powershell
Get-NetTCPConnection -LocalPort 5173 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

或者直接接受 vite fallback 到 5174。

```bash
cd D:/webProject/image2/client
npm run dev
```

打开浏览器：http://localhost:5173/（或 5174）。

Expected:
- 黑底上看到 **5 个清晰的光球**（3 色 + 2 白），分散在屏幕各位置
- 静置 30 秒，光球位置**明显**变了（每个球独立轨迹）
- 每个光球**亮度独立呼吸**（不同球呼吸不同步，整体节奏 10-15s 周期）
- DevTools Console 无 shader compile error / WebGL error
- dot-grid 仍是规则方阵（点阵反射在 Task 3）

如看不到光球：DevTools Console → 看 shader 是否报错；或者临时把 `u_lightCount: 0` 退到 0 看是否能加载（如能则是循环逻辑问题）。

如球完全静止：检查 `motionScale` 值；在 DevTools Console 跑 `window.matchMedia('(prefers-reduced-motion: reduce)').matches` 确认不是被系统偏好关停。

- [ ] **Step 2.10：commit**

```bash
git -C /d/webProject/image2 add client/src/LiquidGlass.tsx client/src/shaders/fragment-bg.glsl
git -C /d/webProject/image2 commit -m "feat(bg): 5 个 Lissajous 轨迹光球替代静态色团，含独立呼吸"
```

---

## Task 3：dot-grid 亮度被光球照亮

**Files:**
- Modify: `client/src/shaders/fragment-bg.glsl`（替换 dot-grid 段）

### 步骤

- [ ] **Step 3.1：替换 dot-grid 段**

修改 `fragment-bg.glsl` 的 `calcCanvasBg` 函数。找到现有 dot-grid 段：

```glsl
  // dot-grid
  float gridSize = 24.0 * u_dpr;
  vec2 gridP = mod(fragPx, gridSize) - gridSize * 0.5;
  float dotR = 1.0 * u_dpr;
  float dotMask = 1.0 - smoothstep(dotR, dotR + 1.0, length(gridP));
  bg += vec3(1.0) * 0.06 * dotMask;
```

整段替换为：

```glsl
  // dot-grid —— 位置不动（作为对齐参考系），亮度被最近光球"照亮"
  float gridSize = 24.0 * u_dpr;
  vec2 gridP = mod(fragPx, gridSize) - gridSize * 0.5;
  float dotR = 1.0 * u_dpr;
  float dotMask = 1.0 - smoothstep(dotR, dotR + 1.0, length(gridP));

  // 每点亮度：基线 0.06 + 离光球 200px 内的加亮（最大 0.06，合计 0.12 上限）
  // 用 max 而非加法，避免多球叠加把亮度推过 0.12
  float dotBoost = 0.0;
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= u_lightCount) break;
    float dd = length(fragPx - u_lightPositions[i]);
    float ringFalloff = smoothstep(200.0 * u_dpr, 0.0, dd);
    dotBoost = max(dotBoost, ringFalloff * u_lightIntensities[i] * 0.06);
  }
  bg += vec3(0.06 + dotBoost) * dotMask;
```

- [ ] **Step 3.2：编译校验**

```bash
cd D:/webProject/image2/client
npm run build
```

Expected: 编译成功。

- [ ] **Step 3.3：dev server 验证点阵照亮效果**

```bash
cd D:/webProject/image2/client
npm run dev
```

Expected:
- 光球附近的 dot-grid 明显比远处更亮（"被照亮"语义可见）
- 离光球 200 CSS px 以外的点阵保持 0.06 暗度
- 光球游走时，被照亮的点阵区域跟着移动
- 光球呼吸时，被照亮的强度跟着呼吸（dot 在最亮峰看着像在"闪烁"，但因为呼吸是 12s 慢周期，应该感觉是"慢慢一亮一暗"而非"闪烁"）

如果点阵看起来没变化：
- 检查 `u_lightPositions` 是否正确传到 bg pass（在 Step 2.4 加的）
- DevTools Console 用 `WebGL Inspector` 或类似扩展 查看 uniform 当前值

- [ ] **Step 3.4：commit**

```bash
git -C /d/webProject/image2 add client/src/shaders/fragment-bg.glsl
git -C /d/webProject/image2 commit -m "feat(bg): dot-grid 亮度受最近光球距离调制（0.06→0.12）"
```

---

## Task 4：性能 trace + 验收清单

> 目标：用 chrome-devtools MCP 实测 GPU 帧时间、对照 spec § 9 逐条验收。

**Files:**
- 无代码修改（仅验证）。若性能不达标，回 Task 2/3 微调振幅或循环。

### 步骤

- [ ] **Step 4.1：dev server 已在运行**

确认 5173/5174 上 vite 仍在跑。如未跑：

```bash
cd D:/webProject/image2/client
npm run dev
```

- [ ] **Step 4.2：用 chrome-devtools MCP 截图（如可用）**

调用 `mcp__chrome-devtools__new_page` 打开 dev server URL，等 1 秒，调 `mcp__chrome-devtools__take_screenshot`。

如果 MCP 报 "browser already running" 锁文件错误：
1. 先用 `mcp__chrome-devtools__list_pages` 看是否有现成 page
2. 用 `mcp__chrome-devtools__select_page` + `mcp__chrome-devtools__navigate_page` 复用
3. 都不行则跳到 Step 4.4 让用户手动验证

肉眼对照截图：
- [ ] 5 个光球清晰可见（3 色 + 2 白）
- [ ] dot-grid 在光球附近明显被照亮

- [ ] **Step 4.3：等 30 秒后再截一张，验证游走**

`mcp__chrome-devtools__evaluate_script` 跑 `await new Promise(r => setTimeout(r, 30000))`，再 `take_screenshot`。

对比两张：
- [ ] 5 个光球的位置都明显不同了
- [ ] 不同球的亮度也不同步变化（独立呼吸）

- [ ] **Step 4.4：Performance trace 测帧时间**

调用 `mcp__chrome-devtools__performance_start_trace`，等 5 秒，再 `performance_stop_trace`。

打开返回结果：
- [ ] 帧时间稳定 < 16.6ms（60fps）
- [ ] CPU 主线程的 RAF 回调耗时 < 1ms（5 球的 Lissajous 计算就是几十 ns）

如 MCP 不可用，请用户手动用 Chrome DevTools Performance 面板验证。

- [ ] **Step 4.5：手动验证 reduce-motion 切换**

在操作系统设置中开启"减少动效"：
- Windows 11: 设置 → 辅助功能 → 视觉效果 → 关闭"动画效果"
- macOS: 系统设置 → 辅助功能 → 显示器 → 勾选"减少动态效果"

**不要刷新浏览器**——MediaQueryList 应实时响应。

Expected:
- 光球停在锚点附近（不再 Lissajous 游走）
- 亮度回到基线 1.0（不再呼吸）
- 切回关闭后光球恢复游走与呼吸

DevTools Console 验证：

```js
window.matchMedia('(prefers-reduced-motion: reduce)').matches
```

- [ ] **Step 4.6：逐条对照 spec § 9 验收清单**

打开 `docs/specs/2026-05-19-animated-background-design.md` § 9，逐条 check：

- [ ] 看到 5 个清晰的"光球"（3 色 + 2 白），分布全屏
- [ ] 静置 30 秒，每个光球位置都明显在不同位置
- [ ] 每个光球独立呼吸（亮度起伏不同步），周期约 10-15 秒
- [ ] dot-grid 在光球附近能明显看出被点亮，远处仍是 0.06 暗点
- [ ] 节点卡拖到光球边界处，玻璃折射也跟着光球缓慢变化
- [ ] 系统级"减少动效"开启时光球冻结、亮度回到基线
- [ ] 鼠标黄光行为与当前一致
- [ ] Performance 60fps，GPU 帧时间增量 < 1ms

任一项不通过：回对应 task 修复后重新走 Task 4。

- [ ] **Step 4.7：如有未提交改动则收尾 commit**

```bash
git -C /d/webProject/image2 status
# 若 clean → 完工
# 若有改动 → git add 具体文件 + commit
```
