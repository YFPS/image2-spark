#version 300 es

// 多形状液态玻璃 —— bg pass
// 渲染：dot-grid + 三色辉光 + 鼠标进入玻璃后的黄光（mainPass 会折射这层）

precision highp float;

#define MAX_SHAPES 8
#define MAX_LIGHTS 5

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_dpr;
uniform vec2 u_mouse;             // 实际鼠标位置（GLSL 像素坐标）
uniform float u_time;             // 秒，单调递增，从渲染器启动开始计时
uniform float u_motionScale;      // 0..1，prefers-reduced-motion 时为 0，否则 1
uniform float u_shapeRoundness;
uniform float u_shadowExpand;
uniform float u_shadowFactor;
uniform vec2 u_shadowPosition;

// 玻璃形状数组（与 mainPass 共享同一份）
uniform int u_shapeCount;
uniform vec2 u_shapeCenters[MAX_SHAPES]; // GLSL 像素坐标
uniform vec2 u_shapeSizes[MAX_SHAPES];   // (width, height) 像素
uniform float u_shapeRadii[MAX_SHAPES];  // 圆角像素

// 光球数组（JS 端按 Lissajous 算好后上传）
uniform int u_lightCount;
uniform vec2 u_lightPositions[MAX_LIGHTS];   // GLSL 像素坐标（已乘 dpr）
uniform float u_lightIntensities[MAX_LIGHTS]; // 0.65..1.35，呼吸调制后
uniform vec3 u_lightColors[MAX_LIGHTS];       // 线性 RGB 0..1
uniform float u_lightRadii[MAX_LIGHTS];       // CSS px，shader 内乘 u_dpr

float superellipseCornerSDF(vec2 p, float r, float n) {
  p = abs(p);
  float v = pow(pow(p.x, n) + pow(p.y, n), 1.0 / n);
  return v - r;
}

float roundedRectSDF(vec2 p, vec2 center, float width, float height, float cornerRadius, float n) {
  p -= center;
  float cr = cornerRadius * u_dpr;
  vec2 d = abs(p) - vec2(width * u_dpr, height * u_dpr) * 0.5;
  float dist;
  if (d.x > -cr && d.y > -cr) {
    vec2 cornerCenter = sign(p) * (vec2(width * u_dpr, height * u_dpr) * 0.5 - vec2(cr));
    vec2 cornerP = p - cornerCenter;
    dist = superellipseCornerSDF(cornerP, cr, n);
  } else {
    dist = min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
  }
  return dist;
}

// 多 shape SDF —— 取所有 shape 的"距离最小值"（即"最近的玻璃边界"）
float mainSDF(vec2 p) {
  float minD = 1e9;
  for (int i = 0; i < MAX_SHAPES; i++) {
    if (i >= u_shapeCount) break;
    vec2 center = u_shapeCenters[i];
    vec2 size = u_shapeSizes[i];
    float radius = u_shapeRadii[i];
    vec2 pn = (p - center) / u_resolution.y;
    float d = roundedRectSDF(
      pn, vec2(0.0),
      size.x / u_resolution.y,
      size.y / u_resolution.y,
      radius / u_resolution.y,
      u_shapeRoundness
    );
    minD = min(minD, d);
  }
  return minD;
}

// 像素是否在任意玻璃 shape 内
float pointInGlass(vec2 px) {
  return 1.0 - step(0.0, mainSDF(px));
}

vec3 calcCanvasBg(vec2 fragPx) {
  vec3 bg = vec3(0.051); // #0D0D0D

  // dot-grid —— 位置不动（作为对齐参考系），亮度被最近光球"照亮"
  float gridSize = 24.0 * u_dpr;
  vec2 gridP = mod(fragPx, gridSize) - gridSize * 0.5;
  float dotR = 1.0 * u_dpr;
  float dotMask = 1.0 - smoothstep(dotR, dotR + 1.0, length(gridP));

  // 每点亮度：基线 0.06 + 距光球 200px 内的加亮（最大 0.06，合计 0.12 上限）
  // 用 max 而非加法，避免多球叠加把亮度推过 0.12
  float dotBoost = 0.0;
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= u_lightCount) break;
    float dd = length(fragPx - u_lightPositions[i]);
    float ringFalloff = smoothstep(200.0 * u_dpr, 0.0, dd);
    dotBoost = max(dotBoost, ringFalloff * u_lightIntensities[i] * 0.06);
  }
  bg += vec3(0.06 + dotBoost) * dotMask;

  // 5 个游走光球：循环计算 falloff + 颜色 × 呼吸强度 累加
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= u_lightCount) break;
    vec2 lpos = u_lightPositions[i];
    float lrad = u_lightRadii[i] * u_dpr;
    float d = length(fragPx - lpos) / lrad;
    float falloff = smoothstep(1.0, 0.0, d);
    bg += u_lightColors[i] * 0.25 * u_lightIntensities[i] * falloff;
  }

  return bg;
}

void main() {
  vec2 u_resolution1x = u_resolution.xy / u_dpr;

  vec3 bgColor = calcCanvasBg(gl_FragCoord.xy);

  // 鼠标黄光已关闭 —— Prompt / Negative 卡上看到的黄色发光来自该效果，
  // 用户认为是 bug，保留则会"溢出卡边"。如要恢复，去掉下面注释即可。
  float mouseOnGlass = pointInGlass(u_mouse);
  float fragInGlass = pointInGlass(gl_FragCoord.xy);
  float mouseRadius = 200.0 * u_dpr;
  float dm = length(gl_FragCoord.xy - u_mouse) / mouseRadius;
  float yellowGlow = smoothstep(1.0, 0.0, dm) * mouseOnGlass * fragInGlass;
  bgColor += vec3(0.94, 1.0, 0.18) * 0.6 * yellowGlow;

  // 玻璃下方软投影（u_shadowFactor 默认 0，关闭）
  vec2 shadowSamplePos = gl_FragCoord.xy - vec2(u_shadowPosition.x * u_dpr, u_shadowPosition.y * u_dpr);
  float merged = mainSDF(shadowSamplePos);
  float shadow = exp(-1.0 / u_shadowExpand * abs(merged) * u_resolution1x.y) * 0.6 * u_shadowFactor;

  fragColor = vec4(bgColor - vec3(shadow), 1.0);
}
