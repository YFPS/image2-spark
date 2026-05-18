/**
 * 液态玻璃层 —— 多形状版本，参数由外部 GlassParams 驱动（动态可调）。
 * 着色器与多通道渲染器移植自 liquid-glass-studio；
 * 全部 shader uniform 通过 paramsRef 让 RAF 循环每帧读最新值，无需重建 GL 资源。
 */
import { useEffect, useRef } from "react";
import { MultiPassRenderer, computeGaussianKernelByRadius } from "./utils/GLUtils";
import VertexShader from "./shaders/vertex.glsl?raw";
import FragmentBgShader from "./shaders/fragment-bg.glsl?raw";
import FragmentBgVblurShader from "./shaders/fragment-bg-vblur.glsl?raw";
import FragmentBgHblurShader from "./shaders/fragment-bg-hblur.glsl?raw";
import FragmentMainShader from "./shaders/fragment-main.glsl?raw";
import type { GlassParams } from "./GlassControls";

const MAX_SHAPES = 8;

export type GlassShape = {
  centerX: number; // CSS 像素，DOM 坐标系（左上为原点）
  centerY: number;
  width: number;
  height: number;
  radius: number; // 绝对像素
};

export function LiquidGlass({
  shapes,
  params,
}: {
  shapes: GlassShape[];
  params: GlassParams;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 让 RAF 每帧读最新形状 / 参数
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;
  const paramsRef = useRef(params);
  paramsRef.current = params;

  // 鼠标位置（DOM 坐标）—— GLSL 背景层会判断鼠标是否在任意玻璃上
  const mouseRef = useRef({ x: -9999, y: -9999 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = window.innerWidth;
    let height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    let renderer: MultiPassRenderer;
    try {
      renderer = new MultiPassRenderer(canvas, [
        { name: "bgPass", shader: { vertex: VertexShader, fragment: FragmentBgShader } },
        {
          name: "vBlurPass",
          shader: { vertex: VertexShader, fragment: FragmentBgVblurShader },
          inputs: { u_prevPassTexture: "bgPass" },
        },
        {
          name: "hBlurPass",
          shader: { vertex: VertexShader, fragment: FragmentBgHblurShader },
          inputs: { u_prevPassTexture: "vBlurPass" },
        },
        {
          name: "mainPass",
          shader: { vertex: VertexShader, fragment: FragmentMainShader },
          inputs: { u_blurredBg: "hBlurPass", u_bg: "bgPass" },
          outputToScreen: true,
        },
      ]);
    } catch (err) {
      console.error("[LiquidGlass] init failed:", err);
      return;
    }

    const gl = canvas.getContext("webgl2");
    if (!gl) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    renderer.resize(canvas.width, canvas.height);

    const onMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", onMouseMove);

    // 预分配数组与高斯核缓存（按 blurRadius 做内存化，避免每帧重算）
    const centersFlat = new Array<number>(MAX_SHAPES * 2).fill(0);
    const sizesFlat = new Array<number>(MAX_SHAPES * 2).fill(0);
    const radiiFlat = new Array<number>(MAX_SHAPES).fill(0);
    let cachedBlurRadius = -1;
    let cachedBlurWeights: number[] = [];

    // 动效时基：从 effect 启动起计时
    const startedAt = performance.now();

    // 系统偏好：减弱动效 → motionScale = 0
    const reducedMotionMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
    let motionScale = reducedMotionMQ.matches ? 0 : 1;
    const onReduceMotionChange = (e: MediaQueryListEvent) => {
      motionScale = e.matches ? 0 : 1;
    };
    reducedMotionMQ.addEventListener("change", onReduceMotionChange);

    let raf: number | null = null;
    const render = () => {
      raf = requestAnimationFrame(render);

      const cw = canvas.width;
      const ch = canvas.height;
      const ss = shapesRef.current;
      const p = paramsRef.current;
      const count = Math.min(ss.length, MAX_SHAPES);

      // 扁平化所有 shape 到数组 uniform
      for (let i = 0; i < count; i++) {
        const s = ss[i];
        centersFlat[i * 2] = s.centerX * dpr;
        centersFlat[i * 2 + 1] = (height - s.centerY) * dpr; // DOM→GLSL y 翻转
        sizesFlat[i * 2] = s.width;
        sizesFlat[i * 2 + 1] = s.height;
        radiiFlat[i] = s.radius;
      }

      const m = mouseRef.current;
      const mouseGlX = m.x * dpr;
      const mouseGlY = (height - m.y) * dpr;

      // 高斯核缓存（blurRadius 变化时才重算）
      if (p.blurRadius !== cachedBlurRadius) {
        cachedBlurRadius = p.blurRadius;
        cachedBlurWeights = computeGaussianKernelByRadius(p.blurRadius);
      }

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

      renderer.render({
        bgPass: {
          u_shadowExpand: p.shadowExpand,
          u_shadowFactor: p.shadowFactor / 100,
          u_shadowPosition: [p.shadowPositionX, p.shadowPositionY],
        },
        mainPass: {
          u_tint: [p.tintR / 255, p.tintG / 255, p.tintB / 255, p.tintA / 100],
          u_refThickness: p.refThickness,
          u_refFactor: p.refFactor,
          u_refDispersion: p.refDispersion,
          u_refFresnelRange: p.refFresnelRange,
          u_refFresnelHardness: p.refFresnelHardness / 100,
          u_refFresnelFactor: p.refFresnelFactor / 100,
          u_glareRange: p.glareRange,
          u_glareHardness: p.glareHardness / 100,
          u_glareConvergence: p.glareConvergence / 100,
          u_glareOppositeFactor: p.glareOppositeFactor / 100,
          u_glareFactor: p.glareFactor,
          u_glareAngle: (p.glareAngle * Math.PI) / 180,
          u_blurEdge: p.blurEdge ? 1 : 0,
        },
      });
    };

    const onResize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      gl.viewport(0, 0, canvas.width, canvas.height);
      renderer.resize(canvas.width, canvas.height);
    };
    window.addEventListener("resize", onResize);

    raf = requestAnimationFrame(render);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMouseMove);
      reducedMotionMQ.removeEventListener("change", onReduceMotionChange);
      if (raf) cancelAnimationFrame(raf);
      renderer.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
    />
  );
}
