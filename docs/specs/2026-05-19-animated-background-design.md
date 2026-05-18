# 动效背景设计稿

> 创建：2026-05-19（v2，重写于同日）
> 状态：草案
> 作用范围：`client/src/LiquidGlass.tsx`、`client/src/shaders/fragment-bg.glsl`

## 1. 背景与现状

当前节点画布的背景由 `LiquidGlass.tsx` 全屏 canvas 渲染，bg pass 的 shader `shaders/fragment-bg.glsl` 画的是：

- `#0D0D0D` 深底
- 24px 规则方阵 dot-grid（白色 6%）
- 三个**位置完全固定**的色团：左上品红、右下青、右中紫罗兰
- 鼠标进入玻璃的黄光（已注释保留，不在本次范围）

shader 内**没有 `u_time` uniform**，每一帧渲染完全相同。前景节点卡用 WebGL 玻璃折射这层背景——所以背景里画什么、玻璃里就会"折射什么"，这条性质决定了动效节奏必须慢。

> **本 spec 已于 2026-05-19 重写。** v1 方案是"色团 fbm 慢漂移 + dot-grid fbm 扭曲"，被用户要求改为"光球游走 + 呼吸发光 + 点阵亮度反射"。已落地的基础设施（`u_time` / `u_motionScale` uniform 与 reduced-motion 监听，commit `9072392`）保留可用。

## 2. 目标

让黑底画布上有**几颗慢慢游走、慢慢呼吸的光球**，节点画布在它们的"光"下工作。具体：

1. **5 个光球**，颜色构成 = 3 个继承色（magenta `#FF50C7`、cyan `#50B5FF`、violet `#8C63FF`）+ 2 个白灯，提供亮度平衡
2. **全屏自由游走**：每球独立的 Lissajous 轨迹（双正弦内积），可以漂到屏幕任意位置；位置变化**超慢**，主漂移周期 ~60 秒
3. **亮度呼吸**：每球独立呼吸相位，光强 ±35% 在基线上下振荡，周期 ~12 秒
4. **dot-grid 亮度被光球照亮**：每个点的亮度 = 0.06 基线 + 受最近光球距离影响的加亮（最高 0.12）；点阵**位置**保持静态，作为对齐参考系
5. **节点玻璃折射纹路**会因背景动态而缓慢变化（免费副产品，不额外做工）
6. **`prefers-reduced-motion: reduce`** 时所有动效冻结于 `t=0` 相位

非目标：

- 鼠标视差跟随
- 光球大小（半径）变化（统一只用"亮度呼吸"表达"呼吸"）
- 光球之间互斥 / 碰撞 / 物理（Lissajous 轨迹可能短暂靠近，接受）
- 把"光球游走"参数暴露给 `GlassControls`
- 移动端 / 低端机额外降级开关

## 3. 设计原则一致性检查

对照 `DESIGN.md` 三铁律：

| 铁律 | 兼容性 |
|---|---|
| UI 灰阶 | ✓ 色彩仅出现在装饰光球上（沿用 v1 色 + 2 白），不改 UI 元素 |
| 颜色让给语义 | ✓ 端口语义色不变；光球色是装饰层、不参与语义 |
| 深度来自玻璃与辉光 | ✓ 光球本身就是"辉光"语言的一部分，强化深度层次 |

## 4. 架构

**JS 端计算光球状态，shader 端渲染**——把"5 个球的位置 / 亮度"的计算从 fragment shader 移到 RAF 循环，每帧只算 5 次而不是每像素一次。Shader 端只做距离衰减与累加。

```
LiquidGlass.tsx
  ├── u_time / u_motionScale（已存在 commit 9072392）
  └── 每帧 RAF：
        计算 5 个球 ──> { pos[i], intensity[i], color[i], radius[i] }
                          │
                          ▼
              setUniforms 上传 4 个数组 uniform
                          │
                          ▼
                fragment-bg.glsl bgPass
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   光球渲染          点阵亮度调制      鼠标黄光（不变）
   for(5) {           for(5) {
     dist             dist
     falloff          point-boost
     accumulate       }
   }                  dotLum = 0.06 + boost
```

每像素负载：5 次距离计算 + 5 次 smoothstep + 5 次累加 = 极便宜。

## 5. JS 端：光球状态计算（`LiquidGlass.tsx`）

### 5.1 配置常量（模块顶层）

```ts
// 5 个光球的静态属性：锚点（uv 0..1）、颜色（线性 RGB 0..1）、半径（CSS px）
// 锚点近似把屏幕分 5 区，避免初始相位下挤一团；轨迹由 Lissajous 决定，不绑死锚点
const LIGHT_BALLS = [
  { anchor: [0.20, 0.30], color: [1.00, 0.31, 0.78], radius: 480, phaseX: 0.0, phaseY: 1.7, breathPhase: 0.0 },
  { anchor: [0.78, 0.22], color: [0.31, 0.71, 1.00], radius: 520, phaseX: 2.1, phaseY: 3.9, breathPhase: 1.3 },
  { anchor: [0.85, 0.70], color: [0.55, 0.39, 1.00], radius: 360, phaseX: 4.3, phaseY: 0.8, breathPhase: 2.7 },
  { anchor: [0.30, 0.78], color: [1.00, 1.00, 1.00], radius: 400, phaseX: 5.5, phaseY: 2.2, breathPhase: 4.1 },
  { anchor: [0.55, 0.50], color: [1.00, 1.00, 1.00], radius: 380, phaseX: 1.0, phaseY: 4.6, breathPhase: 5.5 },
] as const;
```

### 5.2 每帧轨迹算法（在 `render()` 内）

```ts
// 时间标度
const tSec = (performance.now() - startedAt) / 1000;
const t = tSec * motionScale;   // reduced-motion 时 t≡0

// 位置：Lissajous（两个慢正弦不同频率合成"看着随机"的轨迹）
// 频率 0.05 / 0.037 → 二者 LCM ~120 秒，主漂移周期 ~60 秒
// 振幅 ±0.32 视口（dx），±0.28 视口（dy）——锚点居中 + ±30% 漂移可覆盖大半屏幕
const POS_FREQ_A = 0.05;
const POS_FREQ_B = 0.037;
const POS_AMP_X = 0.32;
const POS_AMP_Y = 0.28;
const BREATH_PERIOD = 12;   // 秒
const BREATH_AMP = 0.35;    // ±35%

for (let i = 0; i < 5; i++) {
  const b = LIGHT_BALLS[i];
  const dx = POS_AMP_X * Math.sin(t * POS_FREQ_A + b.phaseX) *
                        Math.cos(t * POS_FREQ_B + b.phaseX * 1.3);
  const dy = POS_AMP_Y * Math.sin(t * POS_FREQ_B + b.phaseY) *
                        Math.cos(t * POS_FREQ_A + b.phaseY * 1.7);
  const px = (b.anchor[0] + dx) * width;
  const py = (b.anchor[1] + dy) * height;

  // DOM → GLSL y 翻转
  lightPosFlat[i * 2] = px * dpr;
  lightPosFlat[i * 2 + 1] = (height - py) * dpr;

  // 呼吸：base=1 + 35% × sin(2π t / 12 + phase)
  const breath = 1 + BREATH_AMP * Math.sin(t * (2 * Math.PI / BREATH_PERIOD) + b.breathPhase);
  lightIntensityFlat[i] = breath;

  lightColorFlat[i * 3] = b.color[0];
  lightColorFlat[i * 3 + 1] = b.color[1];
  lightColorFlat[i * 3 + 2] = b.color[2];

  lightRadiusFlat[i] = b.radius;
}
```

数组在 effect 启动时一次性分配（`new Array(10/5/15/5).fill(0)`），不在 RAF 内 GC。

### 5.3 uniform 推送

把 4 个数组追加到现有 `setUniforms` 调用：

```ts
u_lightCount: 5,
u_lightPositions: lightPosFlat,    // vec2[5] → 10 floats
u_lightIntensities: lightIntensityFlat,  // float[5]
u_lightColors: lightColorFlat,     // vec3[5] → 15 floats
u_lightRadii: lightRadiusFlat,     // float[5]
```

## 6. Shader 端：渲染（`shaders/fragment-bg.glsl`）

### 6.1 新增 uniforms

```glsl
#define MAX_LIGHTS 5

uniform int u_lightCount;
uniform vec2 u_lightPositions[MAX_LIGHTS];   // GLSL 像素坐标
uniform float u_lightIntensities[MAX_LIGHTS]; // 0.65..1.35，呼吸调制后值
uniform vec3 u_lightColors[MAX_LIGHTS];      // 线性 RGB 0..1
uniform float u_lightRadii[MAX_LIGHTS];      // CSS px，未乘 dpr
```

### 6.2 替换 `calcCanvasBg()` 中的色团段

原三段固定色团代码（`top-left magenta blob` / `bottom-right cyan blob` / `mid-right violet blob`）整体替换为：

```glsl
// 5 个光球：循环计算 falloff + 颜色 × 强度累加
for (int i = 0; i < MAX_LIGHTS; i++) {
  if (i >= u_lightCount) break;
  vec2 lpos = u_lightPositions[i];
  float lrad = u_lightRadii[i] * u_dpr;
  float d = length(fragPx - lpos) / lrad;
  float falloff = smoothstep(1.0, 0.0, d);
  // 0.25 系数维持与 v1 色团相当的可见度；呼吸调制后 ±35% 振荡
  bg += u_lightColors[i] * 0.25 * u_lightIntensities[i] * falloff;
}
```

### 6.3 dot-grid 亮度被光球照亮

原 dot-grid 段：

```glsl
float gridSize = 24.0 * u_dpr;
vec2 gridP = mod(fragPx, gridSize) - gridSize * 0.5;
float dotR = 1.0 * u_dpr;
float dotMask = 1.0 - smoothstep(dotR, dotR + 1.0, length(gridP));
bg += vec3(1.0) * 0.06 * dotMask;
```

替换为：

```glsl
float gridSize = 24.0 * u_dpr;
vec2 gridP = mod(fragPx, gridSize) - gridSize * 0.5;
float dotR = 1.0 * u_dpr;
float dotMask = 1.0 - smoothstep(dotR, dotR + 1.0, length(gridP));

// 点阵亮度：基线 0.06 + 最近光球的"照亮加成"
// 加成在光球 200 CSS px 半径内从 0 → 0.06；与光球当前 intensity 同步呼吸
float dotBoost = 0.0;
for (int i = 0; i < MAX_LIGHTS; i++) {
  if (i >= u_lightCount) break;
  float dd = length(fragPx - u_lightPositions[i]);
  float ringFalloff = smoothstep(200.0 * u_dpr, 0.0, dd);
  dotBoost = max(dotBoost, ringFalloff * u_lightIntensities[i] * 0.06);
}
float dotLum = 0.06 + dotBoost;   // 0.06..0.12 上限
bg += vec3(dotLum) * dotMask;
```

注意：用 `max` 而非 `+=`，避免多球叠加把亮度推到 >0.12（视觉上"过爆"）。

### 6.4 删除 Task 1 临时呼吸

`main()` 末尾的 TEMP wiring 块整段删除（Task 1 commit 已留下，本次替换为光球渲染后不再需要）：

```glsl
// === TEMP wiring 验证：整屏亮度做 1Hz 呼吸 ===
// sin(t*2π) 周期 1s，振幅 ±2%；u_motionScale=0 时归零
float breathe = sin(u_time * 6.2831853) * 0.02 * u_motionScale;
bgColor += vec3(breathe);
// === TEMP end ===
```

`u_time` 在新方案里不再被 shader 直接使用（动效改由 JS 驱动），但 uniform 声明保留——`u_motionScale` 仍需要传递给 JS 端做归零判断（其实直接 JS 读 mediaQuery 就够，但保留 uniform 不增加成本，便于将来如果 shader 也想加微妙动效）。

> 实际上 `u_time` 在 v2 不再被 shader 使用。保留还是删除：保留——`detectUniforms()` 会自动注册，多一个 uniform 推送也只是 4 字节，不删 wiring。

## 7. 性能预算

- **目标**：1080p / DPR 1.5，bg pass 增量 ≤ 0.5ms / 帧
- **CPU**：每帧 5 球 × 4 次 Math 三角函数 = 20 次，纳秒级
- **GPU**：每像素 5 球 × (距离 + smoothstep) + 5 球点阵 boost loop = ~30 ALU/像素，远低于 v1 fbm 方案的 ~96 次 hash21/像素
- **不增加** pass / texture / draw call
- **验证**：Chrome DevTools Performance 录制 5 秒，确认 60fps 帧时间 < 16.6ms

## 8. 兜底与边界

| 场景 | 行为 |
|---|---|
| `prefers-reduced-motion: reduce` | `motionScale = 0` → `t = 0` → 球位置为锚点 + 锚点处的 sin/cos 静态值，呼吸 intensity = 1（基线） |
| 系统级偏好运行时切换 | `MediaQueryList.change` 监听实时切换，无需刷新 |
| 后台标签页 | 浏览器 RAF 自动暂停 |
| WebGL 不可用 | 沿用现有 fallback（`bg-canvas` body 底色） |
| 球短暂靠近 / 重叠 | 由颜色加法叠加，最多达到 5×0.25×1.35 ≈ 1.7 → 渲染裁切到 1.0，会出现局部接近白色的"重叠区域"。视觉上接受（看起来像"光团相遇"），不做物理避让 |

## 9. 验收标准

肉眼可观察：

- [ ] 看到 5 个清晰的"光球"：3 色（magenta / cyan / violet）+ 2 白，分布全屏
- [ ] 静置 30 秒，回看每个光球的位置都明显在不同位置（"游走"得到验证）
- [ ] 每个光球独立呼吸（亮度起伏不同步），呼吸周期约 10-15 秒
- [ ] dot-grid 在光球附近能明显看出"被点亮"，远处仍是 0.06 暗点
- [ ] 节点卡拖到光球边界处，玻璃折射也跟着光球缓慢变化
- [ ] 系统级"减少动效"开启时，光球冻结于锚点附近、亮度回到基线
- [ ] 鼠标黄光行为与当前一致（不被动效影响）
- [ ] Performance 60fps，GPU 帧时间增量 < 1ms

## 10. 不在本次范围

- 光球互斥 / 碰撞 / 物理
- 鼠标视差或鼠标"吸引"光球
- 半径呼吸（只做亮度呼吸）
- `GlassControls` 调参
- 移动端降级

如后续要做，单独开 spec。
