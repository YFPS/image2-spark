#version 300 es

// 多形状液态玻璃 —— main pass：折射 / 色散 / 菲涅尔 / 边缘模糊
precision highp float;

#define PI (3.14159265359)
#define MAX_SHAPES 8

const float N_R = 1.0 - 0.02;
const float N_G = 1.0;
const float N_B = 1.0 + 0.02;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_blurredBg;
uniform sampler2D u_bg;
uniform vec2 u_resolution;
uniform float u_dpr;
uniform vec2 u_mouse;
uniform float u_shapeRoundness;
uniform vec4 u_tint;
uniform float u_refThickness;
uniform float u_refFactor;
uniform float u_refDispersion;
uniform float u_refFresnelRange;
uniform float u_refFresnelFactor;
uniform float u_refFresnelHardness;
uniform float u_glareRange;
uniform float u_glareConvergence;
uniform float u_glareOppositeFactor;
uniform float u_glareFactor;
uniform float u_glareHardness;
uniform float u_glareAngle;
uniform int u_blurEdge;

// 玻璃形状数组（与 bg pass 共享同一份）
uniform int u_shapeCount;
uniform vec2 u_shapeCenters[MAX_SHAPES];
uniform vec2 u_shapeSizes[MAX_SHAPES];
uniform float u_shapeRadii[MAX_SHAPES];

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

vec2 getNormal(vec2 p) {
  vec2 h = vec2(max(abs(dFdx(p.x)), 0.0001), max(abs(dFdy(p.y)), 0.0001));
  vec2 grad = vec2(
    mainSDF(p + vec2(h.x, 0.0)) - mainSDF(p - vec2(h.x, 0.0)),
    mainSDF(p + vec2(0.0, h.y)) - mainSDF(p - vec2(0.0, h.y))
  ) / (2.0 * h);
  return grad * 1.414213562 * 1000.0;
}

// LCH 色彩空间转换（保留原版精度）
const vec3 D65_WHITE = vec3(0.95045592705, 1.0, 1.08905775076);
const mat3 RGB_TO_XYZ_M = mat3(0.4124, 0.3576, 0.1805, 0.2126, 0.7152, 0.0722, 0.0193, 0.1192, 0.9505);
const mat3 XYZ_TO_RGB_M = mat3(3.2406255, -1.537208, -0.4986286, -0.9689307, 1.8757561, 0.0415175, 0.0557101, -0.2040211, 1.0569959);
float UNCOMPAND_SRGB(float a) { return a > 0.04045 ? pow((a + 0.055) / 1.055, 2.4) : a / 12.92; }
float COMPAND_RGB(float a) { return a <= 0.0031308 ? 12.92 * a : 1.055 * pow(a, 0.41666666666) - 0.055; }
vec3 RGB_TO_XYZ(vec3 rgb) { return rgb * RGB_TO_XYZ_M; }
vec3 SRGB_TO_RGB(vec3 s) { return vec3(UNCOMPAND_SRGB(s.x), UNCOMPAND_SRGB(s.y), UNCOMPAND_SRGB(s.z)); }
vec3 RGB_TO_SRGB(vec3 r) { return vec3(COMPAND_RGB(r.x), COMPAND_RGB(r.y), COMPAND_RGB(r.z)); }
vec3 SRGB_TO_XYZ(vec3 s) { return RGB_TO_XYZ(SRGB_TO_RGB(s)); }
float XYZ_TO_LAB_F(float x) { return x > 0.00885645167 ? pow(x, 0.333333333) : 7.78703703704 * x + 0.13793103448; }
vec3 XYZ_TO_LAB(vec3 xyz) {
  vec3 s = xyz / D65_WHITE;
  s = vec3(XYZ_TO_LAB_F(s.x), XYZ_TO_LAB_F(s.y), XYZ_TO_LAB_F(s.z));
  return vec3(116.0 * s.y - 16.0, 500.0 * (s.x - s.y), 200.0 * (s.y - s.z));
}
vec3 SRGB_TO_LAB(vec3 s) { return XYZ_TO_LAB(SRGB_TO_XYZ(s)); }
vec3 LAB_TO_LCH(vec3 L) { return vec3(L.x, sqrt(dot(L.yz, L.yz)), atan(L.z, L.y) * 57.2957795131); }
vec3 SRGB_TO_LCH(vec3 s) { return LAB_TO_LCH(SRGB_TO_LAB(s)); }
vec3 XYZ_TO_RGB(vec3 x) { return x * XYZ_TO_RGB_M; }
vec3 XYZ_TO_SRGB(vec3 x) { return RGB_TO_SRGB(XYZ_TO_RGB(x)); }
float LAB_TO_XYZ_F(float x) { return x > 0.206897 ? x * x * x : 0.12841854934 * (x - 0.137931034); }
vec3 LAB_TO_XYZ(vec3 L) {
  float w = (L.x + 16.0) / 116.0;
  return D65_WHITE * vec3(LAB_TO_XYZ_F(w + L.y / 500.0), LAB_TO_XYZ_F(w), LAB_TO_XYZ_F(w - L.z / 200.0));
}
vec3 LAB_TO_SRGB(vec3 l) { return XYZ_TO_SRGB(LAB_TO_XYZ(l)); }
vec3 LCH_TO_LAB(vec3 l) { return vec3(l.x, l.y * cos(l.z * 0.01745329251), l.y * sin(l.z * 0.01745329251)); }
vec3 LCH_TO_SRGB(vec3 l) { return LAB_TO_SRGB(LCH_TO_LAB(l)); }

float vec2ToAngle(vec2 v) {
  float a = atan(v.y, v.x);
  if (a < 0.0) a += 2.0 * PI;
  return a;
}

vec4 getTextureDispersion(sampler2D tex1, sampler2D tex2, float mixRate, vec2 offset, float factor) {
  vec4 pixel = vec4(1.0);
  float bgR = texture(tex1, v_uv + offset * (1.0 - (N_R - 1.0) * factor)).r;
  float bgG = texture(tex1, v_uv + offset * (1.0 - (N_G - 1.0) * factor)).g;
  float bgB = texture(tex1, v_uv + offset * (1.0 - (N_B - 1.0) * factor)).b;
  float blurR = texture(tex2, v_uv + offset * (1.0 - (N_R - 1.0) * factor)).r;
  float blurG = texture(tex2, v_uv + offset * (1.0 - (N_G - 1.0) * factor)).g;
  float blurB = texture(tex2, v_uv + offset * (1.0 - (N_B - 1.0) * factor)).b;
  pixel.r = mix(bgR, blurR, mixRate);
  pixel.g = mix(bgG, blurG, mixRate);
  pixel.b = mix(bgB, blurB, mixRate);
  return pixel;
}

void main() {
  vec2 u_resolution1x = u_resolution.xy / u_dpr;
  float merged = mainSDF(gl_FragCoord.xy);

  vec4 outColor;

  if (merged < 0.005) {
    float nmerged = -1.0 * (merged * u_resolution1x.y);
    float x_R_ratio = 1.0 - nmerged / u_refThickness;
    float thetaI = asin(pow(x_R_ratio, 2.0));
    float thetaT = asin(1.0 / u_refFactor * sin(thetaI));
    float edgeFactor = -1.0 * tan(thetaT - thetaI);
    if (nmerged >= u_refThickness) edgeFactor = 0.0;

    if (edgeFactor <= 0.0) {
      outColor = texture(u_blurredBg, v_uv);
      outColor = mix(outColor, vec4(u_tint.r, u_tint.g, u_tint.b, 1.0), u_tint.a * 0.8);
    } else {
      float edgeH = nmerged / u_refThickness;
      vec2 normal = getNormal(gl_FragCoord.xy);
      vec4 blurredPixel = getTextureDispersion(
        u_bg, u_blurredBg,
        u_blurEdge > 0 ? 1.0 : edgeH,
        -normal * edgeFactor * 0.05 * u_dpr *
          vec2(u_resolution.y / (u_resolution1x.x * u_dpr), 1.0),
        u_refDispersion
      );
      outColor = mix(blurredPixel, vec4(u_tint.r, u_tint.g, u_tint.b, 1.0), u_tint.a * 0.8);

      // 菲涅尔
      float fresnelFactor = clamp(
        pow(1.0 + merged * u_resolution1x.y / 1500.0 * pow(500.0 / u_refFresnelRange, 2.0) + u_refFresnelHardness, 5.0),
        0.0, 1.0
      );
      vec3 fresnelTintLCH = SRGB_TO_LCH(mix(vec3(1.0), vec3(u_tint.r, u_tint.g, u_tint.b), u_tint.a * 0.5));
      fresnelTintLCH.x += 20.0 * fresnelFactor * u_refFresnelFactor;
      fresnelTintLCH.x = clamp(fresnelTintLCH.x, 0.0, 100.0);
      outColor = mix(outColor, vec4(LCH_TO_SRGB(fresnelTintLCH), 1.0),
        fresnelFactor * u_refFresnelFactor * 0.7 * length(normal));

      // 斜向高光
      float glareGeoFactor = clamp(
        pow(1.0 + merged * u_resolution1x.y / 1500.0 * pow(500.0 / u_glareRange, 2.0) + u_glareHardness, 5.0),
        0.0, 1.0
      );
      float glareAngle = (vec2ToAngle(normalize(normal)) - PI / 4.0 + u_glareAngle) * 2.0;
      int glareFarside = 0;
      if (glareAngle > PI * (2.0 - 0.5) && glareAngle < PI * (4.0 - 0.5) || glareAngle < PI * (0.0 - 0.5)) {
        glareFarside = 1;
      }
      float glareAngleFactor =
        (0.5 + sin(glareAngle) * 0.5) *
        (glareFarside == 1 ? 1.2 * u_glareOppositeFactor : 1.2) *
        u_glareFactor;
      glareAngleFactor = clamp(pow(glareAngleFactor, 0.1 + u_glareConvergence * 2.0), 0.0, 1.0);

      vec3 glareTintLCH = SRGB_TO_LCH(mix(blurredPixel.rgb, vec3(u_tint.r, u_tint.g, u_tint.b), u_tint.a * 0.5));
      glareTintLCH.x += 150.0 * glareAngleFactor * glareGeoFactor;
      glareTintLCH.y += 30.0 * glareAngleFactor * glareGeoFactor;
      glareTintLCH.x = clamp(glareTintLCH.x, 0.0, 120.0);

      outColor = mix(outColor, vec4(LCH_TO_SRGB(glareTintLCH), 1.0),
        glareAngleFactor * glareGeoFactor * length(normal));
    }
  } else {
    outColor = texture(u_bg, v_uv);
  }

  outColor = mix(outColor, texture(u_bg, v_uv), smoothstep(-0.001, 0.001, merged));
  fragColor = outColor;
}
