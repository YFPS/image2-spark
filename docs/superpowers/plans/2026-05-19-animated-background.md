# 动效背景实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `LiquidGlass.tsx` 渲染的背景从静态变成 fbm 噪声场驱动的慢动效——三色团位置慢漂移、24px dot-grid 跟同一片噪声场轻微变形，周期约 40 秒，支持系统 `prefers-reduced-motion: reduce` 兜底。

**Architecture:** 在 `shaders/fragment-bg.glsl` 引入 `u_time` / `u_motionScale` uniforms + 一个 3-octaves fbm 函数；色团采样 fbm 得到偏移、点阵在 mod 前用 fbm 扭曲坐标。`LiquidGlass.tsx` 在已有 RAF 循环里追加两行 uniform 推送 + 监听 `prefers-reduced-motion` MediaQueryList。

**Tech Stack:** WebGL2 fragment shader（GLSL 300 es）、React 18 + TS、Vite（`?raw` 导入 shader 字符串）、`window.matchMedia` 用于偏好检测。无新增依赖。

**Reference spec:** `docs/specs/2026-05-19-animated-background-design.md`

**Verification strategy:** 项目无 jest/vitest 测试基础设施，shader 视觉也不适合单测。每个 task 验证靠（1）`npm run build` 编译通过、（2）`npm run dev` + chrome-devtools MCP 截图比对、（3）肉眼对照 spec § 9 验收标准。

---

## 文件结构

| 路径 | 操作 | 职责 |
|---|---|---|
| `client/src/shaders/fragment-bg.glsl` | 修改 | 新增 `u_time` / `u_motionScale` uniform、`hash21`/`vnoise`/`fbm` 函数、应用到色团中心和 dot-grid 坐标 |
| `client/src/LiquidGlass.tsx` | 修改 | 在 effect 内增加：启动时间戳、`prefers-reduced-motion` 监听、每帧推 `u_time`/`u_motionScale` |

无新增文件。无第三方依赖变化。

---

## Task 1：shader 加入 `u_time` / `u_motionScale` uniforms 并通过最小可见效果验证 wiring

> 目标：先打通"JS 推 uniform → shader 读到"的链路，用一个**极简但肉眼可见**的效果（整屏亮度随时间呼吸）验证管线，再做 fbm。
> 这样若后面 fbm 加上去画面没动，至少能排除是 wiring 问题。
> Wiring 验证完之后 Task 2 会把这个临时效果替换成真正的 fbm。

**Files:**
- Modify: `client/src/shaders/fragment-bg.glsl`（在 uniforms 区与 `main()` 末尾）
- Modify: `client/src/LiquidGlass.tsx`（effect 内）

### 步骤

- [ ] **Step 1.1：shader 加 uniform 声明**

修改 `client/src/shaders/fragment-bg.glsl`，在现有 `uniform vec2 u_mouse;` 那一组 uniform 声明之后追加两行：

```glsl
uniform float u_time;          // 秒，单调递增，从渲染器启动开始计时
uniform float u_motionScale;   // 0..1，prefers-reduced-motion 时为 0，否则 1
```

- [ ] **Step 1.2：shader 在 main 末尾加临时呼吸效果**

修改 `fragment-bg.glsl` 的 `main()` 末尾，**在 `fragColor = ...` 这一行之前**插入临时验证代码（Task 2 会删除）：

```glsl
  // === TEMP wiring 验证：整屏亮度做 1Hz 呼吸 ===
  // sin(t*2π) 周期 1s，振幅 ±2%；u_motionScale=0 时归零
  float breathe = sin(u_time * 6.2831853) * 0.02 * u_motionScale;
  bgColor += vec3(breathe);
  // === TEMP end ===
```

- [ ] **Step 1.3：`LiquidGlass.tsx` 引入时间戳和 reduced-motion 监听**

修改 `client/src/LiquidGlass.tsx`，在 `useEffect` 内（具体位置：在 `let raf: number | null = null;` 这一行**之前**）加入：

```ts
    // 动效时基：从 effect 启动起计时
    const startedAt = performance.now();

    // 系统偏好：减弱动效 → motionScale = 0
    const reducedMotionMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
    let motionScale = reducedMotionMQ.matches ? 0 : 1;
    const onReduceMotionChange = (e: MediaQueryListEvent) => {
      motionScale = e.matches ? 0 : 1;
    };
    reducedMotionMQ.addEventListener("change", onReduceMotionChange);
```

- [ ] **Step 1.4：每帧推 `u_time` / `u_motionScale`**

修改 `LiquidGlass.tsx` 内的 `render` 函数。找到现有 `renderer.setUniforms({ ... })` 调用（同时含 `u_resolution`、`u_dpr`、`u_mouse` 等），在那个对象字面量的**末尾**追加两个字段：

```ts
        u_time: (performance.now() - startedAt) / 1000,
        u_motionScale: motionScale,
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
      });
```

- [ ] **Step 1.5：cleanup 加移除监听**

修改 `LiquidGlass.tsx` 的 `useEffect` 返回的 cleanup 函数。找到现有的 `return () => { ... }` 块，在 `if (raf) cancelAnimationFrame(raf);` 之前追加：

```ts
      reducedMotionMQ.removeEventListener("change", onReduceMotionChange);
```

完整 cleanup 形如：

```ts
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMouseMove);
      reducedMotionMQ.removeEventListener("change", onReduceMotionChange);
      if (raf) cancelAnimationFrame(raf);
      renderer.dispose();
    };
```

- [ ] **Step 1.6：编译校验**

```bash
cd client
npm run build
```

Expected: 编译成功，无 TS 错误，无 shader 编译警告。如果失败，看错误信息回滚修改。

- [ ] **Step 1.7：启动 dev server 肉眼验证呼吸效果**

```bash
cd client
npm run dev
```

打开浏览器（默认 http://localhost:5173/）。

Expected:
- 整个画布背景每秒亮度做一次微弱明暗呼吸（±2%）
- 在系统设置中开启"减少动效"（macOS: 辅助功能 → 显示器；Windows: 设置 → 辅助功能 → 视觉效果 → 动画效果），刷新页面后呼吸停止

如果看不到呼吸：检查 DevTools Console 有没有 shader 编译错误；检查 `setUniforms` 调用里两个字段确实加上了。

- [ ] **Step 1.8：commit**

```bash
git add client/src/shaders/fragment-bg.glsl client/src/LiquidGlass.tsx
git commit -m "chore(bg): 接通 u_time / u_motionScale 时间 uniform 与 reduced-motion 监听"
```

---

## Task 2：在 shader 中实现 `hash21` / `vnoise` / `fbm` 函数

> 目标：把 fbm 工具函数加进 shader，但**不**改色团和点阵。先确认编译通过、shader 没死循环、画面仍是 Task 1 的呼吸效果。

**Files:**
- Modify: `client/src/shaders/fragment-bg.glsl`（在 `superellipseCornerSDF` 函数定义**之前**添加）

### 步骤

- [ ] **Step 2.1：插入 fbm 工具函数**

修改 `client/src/shaders/fragment-bg.glsl`，在 `float superellipseCornerSDF(vec2 p, float r, float n) {` 这一行**之前**插入：

```glsl
// 2D hash → [0,1)
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// value noise，插值用 smoothstep
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 3 octaves fbm（固定循环，避免 dynamic indexing 警告）
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  v += a * vnoise(p);             a *= 0.5; p *= 2.0;
  v += a * vnoise(p);             a *= 0.5; p *= 2.0;
  v += a * vnoise(p);
  return v;
}
```

- [ ] **Step 2.2：编译校验**

```bash
cd client
npm run build
```

Expected: 编译成功。GLSL 函数定义在 fragment shader 内合法。如果报 "no matching function" 类错误，检查函数顺序——GLSL 要求被调用的函数定义在上面（我们没在 main 里调用 fbm，所以此 task 不会触发该问题）。

- [ ] **Step 2.3：dev server 验证画面无回归**

```bash
cd client
npm run dev
```

Expected:
- 画面仍然是 Task 1 的"整屏亮度呼吸"效果，行为未变（因为 fbm 函数定义了但还没被调用）
- DevTools Console 无新报错

- [ ] **Step 2.4：commit**

```bash
git add client/src/shaders/fragment-bg.glsl
git commit -m "feat(bg-shader): 新增 hash21 / vnoise / fbm 噪声工具函数"
```

---

## Task 3：把临时呼吸替换为色团位置漂移

> 目标：删除 Task 1 的临时呼吸代码，把 fbm 接到三个色团的 `c1` / `c2` / `c3` 上，色团开始慢漂移。点阵在本 task 中**仍然保持规则方阵**——下个 task 才动它。

**Files:**
- Modify: `client/src/shaders/fragment-bg.glsl`（删除 TEMP，改 `calcCanvasBg`）

### 步骤

- [ ] **Step 3.1：删除 Task 1 的临时呼吸代码**

修改 `client/src/shaders/fragment-bg.glsl` 的 `main()` 函数，删除之前插入的整块：

```glsl
  // === TEMP wiring 验证：整屏亮度做 1Hz 呼吸 ===
  // sin(t*2π) 周期 1s，振幅 ±2%；u_motionScale=0 时归零
  float breathe = sin(u_time * 6.2831853) * 0.02 * u_motionScale;
  bgColor += vec3(breathe);
  // === TEMP end ===
```

- [ ] **Step 3.2：在 `calcCanvasBg` 顶部计算时间项**

修改 `fragment-bg.glsl` 的 `calcCanvasBg` 函数。注意：当前函数签名是 `vec3 calcCanvasBg(vec2 fragPx)`，没有 `u_time` 参数——但 `u_time` 是 uniform，函数体内可以直接读取，无需改签名。

在函数体的**第一行**（在 `vec3 bg = vec3(0.051);` 之前）加入：

```glsl
  float t = u_time * u_motionScale;
```

- [ ] **Step 3.3：替换三个色团中心计算**

在同一个 `calcCanvasBg` 函数里，找到现有三段：

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

整段替换为：

```glsl
  // top-left magenta blob —— 中心受 fbm 慢漂移（±15% 视口高度）
  vec2 off1 = (vec2(fbm(vec2(0.7, 1.3) + t * 0.025),
                    fbm(vec2(17.0, 3.0) + t * 0.025)) - 0.5)
              * 0.30 * u_resolution.y;
  vec2 c1 = vec2(u_resolution.x * 0.25, u_resolution.y * 1.0) + off1;
  float d1 = length(fragPx - c1) / (480.0 * u_dpr);
  bg += vec3(1.0, 0.31, 0.78) * 0.25 * smoothstep(1.0, 0.0, d1);

  // bottom-right cyan blob
  vec2 off2 = (vec2(fbm(vec2(5.0, 29.0) + t * 0.025),
                    fbm(vec2(33.0, 8.0) + t * 0.025)) - 0.5)
              * 0.30 * u_resolution.y;
  vec2 c2 = vec2(u_resolution.x * 0.75, u_resolution.y * 0.0) + off2;
  float d2 = length(fragPx - c2) / (520.0 * u_dpr);
  bg += vec3(0.31, 0.71, 1.0) * 0.20 * smoothstep(1.0, 0.0, d2);

  // mid-right violet blob
  vec2 off3 = (vec2(fbm(vec2(41.0, 11.0) + t * 0.025),
                    fbm(vec2(2.0, 23.0) + t * 0.025)) - 0.5)
              * 0.30 * u_resolution.y;
  vec2 c3 = vec2(u_resolution.x * 0.90, u_resolution.y * 0.66) + off3;
  float d3 = length(fragPx - c3) / (360.0 * u_dpr);
  bg += vec3(0.55, 0.39, 1.0) * 0.18 * smoothstep(1.0, 0.0, d3);
```

- [ ] **Step 3.4：编译校验**

```bash
cd client
npm run build
```

Expected: 编译成功。如失败常见原因：fbm 函数没在 calcCanvasBg 之前定义——确认 Task 2 的函数块在 superellipseCornerSDF 之前（即文件靠上）。

- [ ] **Step 3.5：dev server 肉眼验证色团漂移**

```bash
cd client
npm run dev
```

Expected:
- 打开页面后**先不要动**，盯着画面 10 秒。10 秒后能明显看出三个色团的位置和上一秒不一样
- 把节点卡拖到色团边界处，玻璃折射纹路跟着色团缓慢变化
- dot-grid 仍是规则方阵（未动它）
- 系统级"减少动效"开启时画面静止（位置等同于 t=0 的相位，与原本静态版本视觉差异极小）

如果色团**不漂移**：检查浏览器 DevTools，看 fragment-bg 着色器是否报"undefined function fbm"——Task 2 函数顺序问题。

- [ ] **Step 3.6：commit**

```bash
git add client/src/shaders/fragment-bg.glsl
git commit -m "feat(bg): 三色团位置随 fbm 噪声场慢漂移，移除临时呼吸"
```

---

## Task 4：dot-grid 跟同一片 fbm 扭曲

**Files:**
- Modify: `client/src/shaders/fragment-bg.glsl`（修改 `calcCanvasBg` 的 dot-grid 段）

### 步骤

- [ ] **Step 4.1：替换 dot-grid 坐标计算**

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
  // dot-grid —— mod 前对像素坐标做 fbm 扭曲（±6 CSS px）
  float gridSize = 24.0 * u_dpr;
  vec2 warp = vec2(
    fbm(fragPx * 0.002 + vec2(0.0, t * 0.02)),
    fbm(fragPx * 0.002 + vec2(7.0, t * 0.02))
  ) - 0.5;
  vec2 gridP = mod(fragPx + warp * 6.0 * u_dpr, gridSize) - gridSize * 0.5;
  float dotR = 1.0 * u_dpr;
  float dotMask = 1.0 - smoothstep(dotR, dotR + 1.0, length(gridP));
  bg += vec3(1.0) * 0.06 * dotMask;
```

注意：`t` 变量已经在 Task 3 Step 3.2 引入到 `calcCanvasBg` 顶部，本步直接使用。

- [ ] **Step 4.2：编译校验**

```bash
cd client
npm run build
```

Expected: 编译成功。

- [ ] **Step 4.3：dev server 肉眼验证点阵动效**

```bash
cd client
npm run dev
```

Expected:
- 点阵不再是严格规则方阵，每个点位置有轻微偏移（最大 ±6 CSS px）
- 静置 10-20 秒，能看出点阵整体在"水波"状缓慢流动
- 仍能感觉到是"网格"而不是"星点散布"——24px 节距 vs ±6px 扭曲 = 网格规律仍主导
- 玻璃折射部分点阵也跟着流动（双重折射，画面更"湿润"）
- 系统级"减少动效"开启后点阵静止于初始相位

- [ ] **Step 4.4：commit**

```bash
git add client/src/shaders/fragment-bg.glsl
git commit -m "feat(bg): dot-grid 坐标在 mod 前用 fbm 扭曲，呈现水波下鹅卵石感"
```

---

## Task 5：性能验证 & 与 spec 验收清单对照

> 目标：用 chrome-devtools MCP 实测 GPU 帧时间，对照 spec § 9 全部走一遍。若 GPU 帧时间超 1ms，触发 spec § 7 备选优化路径；否则跳过备选直接收尾。

**Files:**
- 无代码修改（仅验证；若触发备选才修改 `fragment-bg.glsl`）

### 步骤

- [ ] **Step 5.1：启动 dev server**

```bash
cd client
npm run dev
```

确认 http://localhost:5173/ 加载成功。

- [ ] **Step 5.2：用 chrome-devtools MCP 截图初始状态**

调用 `mcp__chrome-devtools__navigate_page` 打开 http://localhost:5173/，等页面渲染稳定后调用 `mcp__chrome-devtools__take_screenshot`。

肉眼对照截图，验证 spec § 9：
- [ ] 色团位置可见（截图里能看到 magenta / cyan / violet）
- [ ] dot-grid 不再是严格方阵

- [ ] **Step 5.3：等 10 秒后再截一张，做位置对比**

调用 `mcp__chrome-devtools__wait_for` 等 10 秒（或直接 `evaluate_script` 跑 `await new Promise(r => setTimeout(r, 10000))`），再调 `take_screenshot`。

对比两张截图：色团应该明显移动了（≥ 30 像素的视觉位移）；点阵局部偏移可见但仍维持网格大势。

- [ ] **Step 5.4：录 Performance trace 测 GPU 帧时间**

调用 `mcp__chrome-devtools__performance_start_trace`，等 5 秒，再 `performance_stop_trace`。

打开返回结果，查 "GPU" 轨道或 "Frame" 信息：
- Expected: 帧时间 < 16.6ms（即 60fps）
- Expected: GPU 部分增量相比无动效版本 < 1ms（spec § 7 预算）

如何粗估增量：和静态版本对比的话，需要先 `git stash` + reload + trace 一次，再 `git stash pop` + reload + trace 一次。可选——若总帧时间已经远 < 16ms，可以跳过对比直接判通过。

- [ ] **Step 5.5：决策点 —— 性能是否在预算内？**

- 如果 GPU 帧时间增量 ≤ 1ms：**跳到 Step 5.7**（不需要备选优化）
- 如果增量 > 1ms：**执行 Step 5.6**（触发 spec § 7 备选优化）

- [ ] **Step 5.6（条件执行）：备选优化 —— 色团 fbm 减半**

仅当 Step 5.5 判断需要优化时执行：

把 `fragment-bg.glsl` 中 Task 3 的三组色团偏移代码改为单 fbm + cos/sin 投影。每色团从 2 次 fbm 降到 1 次。完整替换内容：

```glsl
  // top-left magenta blob —— 单 fbm + 圆轨投影
  float n1 = fbm(vec2(0.7, 1.3) + t * 0.025);
  vec2 off1 = vec2(cos(n1 * 6.2831853), sin(n1 * 6.2831853)) * 0.15 * u_resolution.y;
  vec2 c1 = vec2(u_resolution.x * 0.25, u_resolution.y * 1.0) + off1;
  float d1 = length(fragPx - c1) / (480.0 * u_dpr);
  bg += vec3(1.0, 0.31, 0.78) * 0.25 * smoothstep(1.0, 0.0, d1);

  // bottom-right cyan blob
  float n2 = fbm(vec2(5.0, 29.0) + t * 0.025);
  vec2 off2 = vec2(cos(n2 * 6.2831853), sin(n2 * 6.2831853)) * 0.15 * u_resolution.y;
  vec2 c2 = vec2(u_resolution.x * 0.75, u_resolution.y * 0.0) + off2;
  float d2 = length(fragPx - c2) / (520.0 * u_dpr);
  bg += vec3(0.31, 0.71, 1.0) * 0.20 * smoothstep(1.0, 0.0, d2);

  // mid-right violet blob
  float n3 = fbm(vec2(41.0, 11.0) + t * 0.025);
  vec2 off3 = vec2(cos(n3 * 6.2831853), sin(n3 * 6.2831853)) * 0.15 * u_resolution.y;
  vec2 c3 = vec2(u_resolution.x * 0.90, u_resolution.y * 0.66) + off3;
  float d3 = length(fragPx - c3) / (360.0 * u_dpr);
  bg += vec3(0.55, 0.39, 1.0) * 0.18 * smoothstep(1.0, 0.0, d3);
```

注意：色团 seed 仍是 `(0.7,1.3)` / `(5,29)` / `(41,11)`，与原方案保持一致，确保三色团动效相位不会同步。

重跑 `npm run build` + `npm run dev` + Step 5.4 trace，验证增量 ≤ 1ms。

commit:

```bash
git add client/src/shaders/fragment-bg.glsl
git commit -m "perf(bg): 色团位置用 1 次 fbm + cos/sin 投影，每像素省 3 次 fbm"
```

- [ ] **Step 5.7：开启系统"减少动效"，手动验证回退**

在操作系统设置中开启"减少动效"偏好：
- Windows 11: 设置 → 辅助功能 → 视觉效果 → 把"动画效果"关掉
- macOS: 系统设置 → 辅助功能 → 显示器 → 勾选"减少动态效果"

**不要刷新浏览器**——MediaQueryList 的 `change` 监听应实时响应。

Expected:
- 切换"减少动效"开启后，画面 1-2 秒内停止所有动效（实际上一帧就停）
- 切换回关闭后，画面恢复动效
- 系统偏好持久化，开新 tab 也应保持

如果切换不生效，去 DevTools Console 跑：

```js
window.matchMedia('(prefers-reduced-motion: reduce)').matches
```

确认浏览器读到正确值；若浏览器值正确但画面没停，回查 `LiquidGlass.tsx` 的 `motionScale` 是否在 `setUniforms` 中实际传递。

- [ ] **Step 5.8：与 spec § 9 验收清单逐条对照**

打开 `docs/specs/2026-05-19-animated-background-design.md` § 9，逐条 check：

- [ ] 静置 10 秒，回看背景，色团位置肉眼可见地变了
- [ ] 节点卡片拖到色团交界处，玻璃折射纹路缓慢变化，不"卡住一帧"或剧烈晃动
- [ ] 点阵看上去不像规则方阵，呈"水波下的鹅卵石"感，仍有大致网格规律
- [ ] 系统设置开启"减少动效"后画面完全静止
- [ ] 鼠标移动到玻璃上，黄光行为与当前一致
- [ ] Performance 面板 60fps，GPU 帧时间增量 < 1ms

任一项不通过则回到对应 task 修复并重新走 Task 5。

- [ ] **Step 5.9：如果有遗漏的修改产生了 commit，做一个收尾 commit；否则跳过**

```bash
git status
# 若 working tree clean → 直接结束
# 若有未提交改动 → git add ... && git commit -m "..."
```
