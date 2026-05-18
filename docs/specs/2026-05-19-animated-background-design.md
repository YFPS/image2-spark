# 动效背景设计稿

> 创建：2026-05-19
> 状态：草案
> 作用范围：`client/src/LiquidGlass.tsx`、`client/src/shaders/fragment-bg.glsl`

## 1. 背景与现状

当前节点画布的背景由 `LiquidGlass.tsx` 全屏 canvas 渲染，bg pass 的 shader `shaders/fragment-bg.glsl` 画的是：

- `#0D0D0D` 深底
- 24px 规则方阵 dot-grid（白色 6%）
- 三个**位置完全固定**的色团：左上品红、右下青、右中紫罗兰
- 鼠标进入玻璃的黄光（已注释保留，不在本次范围）

shader 内**没有 `u_time` uniform**，每一帧渲染完全相同，整个画面是静态的。前景节点卡用 WebGL 玻璃折射这层背景，所以背景里画什么、玻璃里就会"折射什么"——这条性质决定了动效节奏必须慢。

## 2. 目标

让背景"活"起来，但不干扰节点编辑工作流。具体：

1. 三个色团位置随时间慢漂移（幅度 ≈ 视口 ±15%）
2. dot-grid 不再是规则方阵，每个点随同一片噪声场轻微变形（幅度 ≈ ±6px）
3. 总周期 **40-50 秒**，肉眼第一眼看不出在动，隔 5 秒回看位置明显不同
4. 节点卡的玻璃折射纹路因此跟着慢慢变化（免费副产品，加强玻璃真实感）
5. 系统 `prefers-reduced-motion: reduce` 时画面完全静止，回退到当前状态

非目标：

- 鼠标视差、色相变化、整体亮度呼吸
- 暴露给 `GlassControls` 的可调参数
- 移动端/低端机额外降级（DPR 已经压低后 GPU 余量充足）

## 3. 设计原则一致性检查

对照 `DESIGN.md` 三铁律：

| 铁律 | 兼容性 |
|---|---|
| UI 灰阶 | ✓ 仅动位置/形状，不改颜色（仍是现有 magenta/cyan/violet 色团） |
| 颜色让给语义 | ✓ 色团本就是装饰层，不参与端口语义色，动效不引入新色 |
| 深度来自玻璃与辉光 | ✓ 不动玻璃和发光，只动其下方的色团 |

## 4. 架构

复用同一个 fbm 函数，色团与点阵各自取不同的采样点与频率系数。数据流：

```
LiquidGlass.tsx ──u_time (秒) ─┐
                ──u_motionScale (0/1) ─┐
                                       ▼
                            fragment-bg.glsl
                                       │
                                       ▼
                          fbm(uv, t) （函数共享，采样点不同）
                              │              │
                              ▼              ▼
              色团：3 个色团各 2 次采样   点阵：每像素 1 次采样
              得到 (dx, dy)，加到 c_i    得到 (dx, dy)，扭曲 grid
```

GLSL 内只有 fbm 函数体被共享；shader 端不暴露"全局噪声场"的存在，CPU 端只负责递增 `u_time` 和切换 `u_motionScale`。

## 5. Shader 改动（`shaders/fragment-bg.glsl`）

### 5.1 新增 uniforms

```glsl
uniform float u_time;          // 秒，单调递增，从渲染器启动开始计时
uniform float u_motionScale;   // 0..1，prefers-reduced-motion 时为 0，否则 1
```

### 5.2 新增噪声函数（~25 行，固定 octave 数）

```glsl
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);   // smoothstep
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 3 octaves，固定循环避免 dynamic indexing 警告
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  v += a * vnoise(p);           a *= 0.5; p *= 2.0;
  v += a * vnoise(p);           a *= 0.5; p *= 2.0;
  v += a * vnoise(p);
  return v;
}
```

### 5.3 在 `calcCanvasBg()` 中应用

时间项统一乘 `u_motionScale`，关闭动效时所有 `t` 折叠为 0：

```glsl
float t = u_time * u_motionScale;

// 色团：原 c1/c2/c3 各加一个低频偏移
//   - 时间项 t * 0.025：显著位置变化时间尺度 ~40s（fbm 非严格周期）
//   - 振幅 (fbm - 0.5) * 0.30 → ±15%，按视口高度比例缩放保持各分辨率视觉一致
//   - 三个色团 seed 各错开，避免同步漂移
// 色团 1 —— 左上品红
vec2 off1 = (vec2(fbm(vec2(0.7, 1.3) + t * 0.025),
                  fbm(vec2(17.0, 3.0) + t * 0.025)) - 0.5)
            * 0.30 * u_resolution.y;
vec2 c1 = vec2(u_resolution.x * 0.25, u_resolution.y * 1.0) + off1;

// 色团 2 —— 右下青
vec2 off2 = (vec2(fbm(vec2(5.0, 29.0) + t * 0.025),
                  fbm(vec2(33.0, 8.0) + t * 0.025)) - 0.5)
            * 0.30 * u_resolution.y;
vec2 c2 = vec2(u_resolution.x * 0.75, u_resolution.y * 0.0) + off2;

// 色团 3 —— 右中紫罗兰
vec2 off3 = (vec2(fbm(vec2(41.0, 11.0) + t * 0.025),
                  fbm(vec2(2.0, 23.0) + t * 0.025)) - 0.5)
            * 0.30 * u_resolution.y;
vec2 c3 = vec2(u_resolution.x * 0.90, u_resolution.y * 0.66) + off3;

// 点阵：原 gridP 求模前先做坐标扭曲
//   - 噪声采样频率 0.002，保证 24px 网格内单点扭动平滑
//   - 振幅 6px（DPR 后再乘），约 24px 网格的 1/4，足够"非方阵"但不破坏对齐感
vec2 warp = vec2(
  fbm(fragPx * 0.002 + vec2(0.0, t * 0.02)),
  fbm(fragPx * 0.002 + vec2(7.0, t * 0.02))
) - 0.5;
vec2 gridP = mod(fragPx + warp * 6.0 * u_dpr, gridSize) - gridSize * 0.5;
```

fbm 本身不是严格周期函数，但时间项变化 1 个 fbm 单位（即 `t * 0.025 = 1.0`，约 **40 秒**）时低频 octave 的相位推进约 1 弧度，肉眼感知到明显的位置变化。色团与点阵时间系数错开（0.025 vs 0.02），避免两层视觉拍频。

### 5.4 鼠标黄光不变

`yellowGlow` 这段保持原样，不参与动效。

## 6. JS 改动（`LiquidGlass.tsx`）

约 10 行新增，放在 effect 内 `render` 函数之前与之内：

```ts
const startedAt = performance.now();
const reducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
let motionScale = reducedMotionMQ.matches ? 0 : 1;
const onReduceMotionChange = (e: MediaQueryListEvent) => {
  motionScale = e.matches ? 0 : 1;
};
reducedMotionMQ.addEventListener('change', onReduceMotionChange);

// render() 内追加到 setUniforms 调用：
const tSec = (performance.now() - startedAt) / 1000;
renderer.setUniforms({
  // 既有字段保持不变 ...
  u_time: tSec,
  u_motionScale: motionScale,
});

// cleanup 内追加：
reducedMotionMQ.removeEventListener('change', onReduceMotionChange);
```

不改 `GlassControls`、`GlassParams`、`localStorage` 存档结构——动效参数全在 shader 常量里，避免污染用户调参数据。

## 7. 性能预算

- **目标**：1080p / DPR 1.5，bg pass 增量 ≤ 0.5ms / 帧
- **新增计算**：每像素 fbm 调用次数 = 3 色团 × 2 分量 + 点阵 2 分量 = **8 次 fbm**；每次 fbm 3 octaves × 每 octave 4 次 hash21 = 12 次 hash21；总计 **≈ 96 次 hash21 / 像素**。hash21 是几条 ALU 指令，对现代 GPU 而言负担小
- **不增加 pass / texture / draw call**，纯 fragment 算力
- **验证**：Chrome DevTools Performance 录制 5 秒，查 GPU 帧时间柱状图，确保 60fps 帧预算 16.6ms 中 GPU 部分增量 < 1ms
- **备选优化**：如实测 GPU 帧时间超 1ms，可把每色团 2 次 fbm 改为 1 次 fbm + `vec2(cos, sin)` 投影，色团 fbm 调用从 6 次降到 3 次，总 fbm 5 次，hash21 ~60 次/像素

## 8. 兜底与边界

| 场景 | 行为 |
|---|---|
| `prefers-reduced-motion: reduce` | `u_motionScale = 0`，画面静止于"动效初始相位"，与当前静态版本视觉一致 |
| 系统级偏好运行时切换 | `mediaQuery.addEventListener('change')` 实时切换，无需刷新 |
| 后台标签页 | 浏览器 RAF 自动暂停，无额外代码 |
| WebGL 不可用 | 沿用现有 fallback（`bg-canvas` body 底色），不受本次改动影响 |
| `u_time` 溢出 | float32 在 ~16M 秒（约 6 个月连续运行）后开始丢精度。不处理——单页应用刷新后归零 |

## 9. 验收标准

肉眼可观察：

- [ ] 静置 10 秒，回看背景，色团位置肉眼可见地变了
- [ ] 把节点卡片拖到色团交界处，玻璃折射纹路缓慢变化（不应"卡住一帧"或剧烈晃动）
- [ ] 点阵看上去不像规则方阵，呈"水波下的鹅卵石"感，仍有大致的网格规律
- [ ] 在系统设置开启"减少动效"后，画面完全静止
- [ ] 鼠标移动到玻璃上，黄光行为与当前一致（不被动效影响）
- [ ] Performance 面板：60fps，GPU 帧时间增量 < 1ms

## 10. 不在本次范围

- 鼠标视差跟随
- 色团颜色相位变化（hue shift / 呼吸）
- 极光式条带、流体噪声以外的其他风格
- 暴露给 `GlassControls` 的运行时调参
- 移动端 GPU 降级开关

如后续要做，单独开 spec。
