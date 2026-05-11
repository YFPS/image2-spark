/**
 * image2 —— AI 图像生成 SaaS（节点画布编辑器）。
 *
 * 严格按 D:\webProject\image2\DESIGN.md：
 *  - 三铁律：UI 灰阶 / 颜色让给语义（端口=数据类型）/ 深度来自玻璃与辉光
 *  - 节点卡：14px 圆角、14px 内边距、glass-surface（rgba(28,28,32,~0.6)）
 *  - 端口：10px 圆点 + 2px canvas 外环 + 同色 6px glow，半在卡内半在卡外
 *  - 唯一发光：Generate 电黄胶囊（顶部全局）
 *  - 连线：1.25px 贝塞尔，颜色 = 源端口色，运行时高亮（demo 略）
 *
 * 架构：每个节点声明自己的 ports（side/top/color），连线从声明读端口位置，
 *       因此节点内部布局调整不会让连线错位（单一真相源）。
 */
import type {
  ButtonHTMLAttributes,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LiquidGlass, type GlassShape } from "./LiquidGlass";
import { GlassControls, loadStoredParams, type GlassParams } from "./GlassControls";

// 卡片物理尺寸 —— 同时驱动 WebGL 玻璃形状
// 统一宽度：所有节点 280px；Preview 略宽 320px
const NODE_W = 280;
const MODEL_CARD_W = NODE_W;
const MODEL_CARD_H = 240;
const PROMPT_CARD_W = NODE_W;
const PROMPT_CARD_H = 290;
const NEGATIVE_PROMPT_CARD_W = NODE_W;
const NEGATIVE_PROMPT_CARD_H = 290;
const IMAGE_GEN_CARD_W = NODE_W;
const IMAGE_GEN_CARD_H = 440;
const PREVIEW_CARD_W = 320;
// 玻璃覆盖区域 = 标题 + 主缩略图灰卡；操作栏独立浮在玻璃下方（不被玻璃包裹）
const PREVIEW_GLASS_H = 540;
const PREVIEW_BAR_GAP = 12;
const PREVIEW_BAR_H = 56;
const PREVIEW_CARD_H = PREVIEW_GLASS_H + PREVIEW_BAR_GAP + PREVIEW_BAR_H;

/* ---------- 类型 & 数据 ---------- */
type Point = { x: number; y: number };
type Side = "left" | "right";
// NodeType = 5 种节点模板（"种类"）。允许同种类多实例
type NodeType = "model" | "prompt" | "negativePrompt" | "imageGen" | "preview";

type PortDef = {
  id: string;          // 在节点内唯一
  side: Side;          // 卡的哪一边
  top: number;         // 距卡片顶部的像素（端口圆心 y）
  color: string;       // 端口语义色（也作为连线色）
};

type NodeDef = {
  id: NodeType;
  width: number;
  ports: PortDef[];
};

// 节点实例：每个画布上的卡片都是一个实例
type NodeInstance = {
  id: string;          // 实例唯一 ID（如 "model-1"、"prompt-1739..."）
  type: NodeType;      // 模板种类
  position: Point;
};

// 卡片尺寸表 —— 按 NodeType 查
function getCardDims(type: NodeType): { w: number; h: number; glassH: number } {
  switch (type) {
    case "model":          return { w: MODEL_CARD_W, h: MODEL_CARD_H, glassH: MODEL_CARD_H };
    case "prompt":         return { w: PROMPT_CARD_W, h: PROMPT_CARD_H, glassH: PROMPT_CARD_H };
    case "negativePrompt": return { w: NEGATIVE_PROMPT_CARD_W, h: NEGATIVE_PROMPT_CARD_H, glassH: NEGATIVE_PROMPT_CARD_H };
    case "imageGen":       return { w: IMAGE_GEN_CARD_W, h: IMAGE_GEN_CARD_H, glassH: IMAGE_GEN_CARD_H };
    case "preview":        return { w: PREVIEW_CARD_W, h: PREVIEW_CARD_H, glassH: PREVIEW_GLASS_H };
  }
}

// DESIGN.md 端口语义色
const C = {
  model: "#F0FE2D",
  positive: "#7CE38B",
  negative: "#FF7E87",
  image: "#4CB1FF",
  output: "#FF7E87",
};

// 节点定义：宽度 + 端口表
// top 值即"端口圆心距卡顶的 y"，是 Port DOM 和 Wire 端点共用的唯一坐标
const NODES: Record<NodeType, NodeDef> = {
  // 嵌套式 Model 卡，端口对外锚点是"内层卡 model 行右侧贴外层卡右边"
  // 实际渲染时端口贴在内层卡内（不外露），但 Wire 仍以外层卡右边缘为出发点
  // 端口 y 重算：title 改为 pb-2（少 8），所有 port.top 同步减 8
  model: {
    id: "model",
    width: MODEL_CARD_W,
    ports: [{ id: "out", side: "right", top: 68, color: C.model }],
  },
  prompt: {
    id: "prompt",
    width: PROMPT_CARD_W,
    ports: [{ id: "positive", side: "right", top: 78, color: C.positive }],
  },
  negativePrompt: {
    id: "negativePrompt",
    width: NEGATIVE_PROMPT_CARD_W,
    ports: [{ id: "out", side: "right", top: 78, color: C.negative }],
  },
  imageGen: {
    id: "imageGen",
    width: IMAGE_GEN_CARD_W,
    ports: [
      { id: "model", side: "left", top: 68, color: C.model },
      { id: "positive", side: "left", top: 92, color: C.positive },
      { id: "negative", side: "left", top: 116, color: C.negative },
      { id: "image", side: "right", top: 68, color: C.image },
    ],
  },
  preview: {
    id: "preview",
    width: PREVIEW_CARD_W,
    ports: [{ id: "in", side: "left", top: 74, color: C.image }],
  },
};

// Edge from/to 用 [instanceId, portId] 表示
type Edge = { from: [string, string]; to: [string, string] };

// 初始 5 个节点实例（保持现有布局）
const INITIAL_INSTANCES: NodeInstance[] = [
  { id: "model-1",   type: "model",          position: { x: 60, y: 70 } },
  { id: "prompt-1",  type: "prompt",         position: { x: 60, y: 420 } },
  { id: "neg-1",     type: "negativePrompt", position: { x: 60, y: 760 } },
  { id: "imageGen-1",type: "imageGen",       position: { x: 500, y: 180 } },
  { id: "preview-1", type: "preview",        position: { x: 920, y: 200 } },
];

const INITIAL_EDGES: Edge[] = [
  { from: ["model-1", "out"], to: ["imageGen-1", "model"] },
  { from: ["prompt-1", "positive"], to: ["imageGen-1", "positive"] },
  { from: ["neg-1", "out"], to: ["imageGen-1", "negative"] },
  { from: ["imageGen-1", "image"], to: ["preview-1", "in"] },
];

// 拖动中的连线草稿
type DraftEdge = {
  fromInstance: string;
  fromPort: string;
  origin: Point;
  color: string;
  side: Side;
  mouse: Point;
};

// 右键上下文菜单状态
type ContextMenuState = {
  screenX: number; // 鼠标按下时的屏幕坐标（菜单显示用）
  screenY: number;
  canvasX: number; // 转换到画布坐标（新节点放置用）
  canvasY: number;
};

// 可添加的节点种类清单（菜单项）
const NODE_TYPE_LIST: { type: NodeType; label: string; color: string }[] = [
  { type: "model",          label: "Model",           color: C.model },
  { type: "prompt",         label: "Prompt",          color: C.positive },
  { type: "negativePrompt", label: "Negative Prompt", color: C.negative },
  { type: "imageGen",       label: "Image Generator", color: C.image },
  { type: "preview",        label: "Preview Image",   color: C.image },
];

// 顶部条占用的高度，鼠标坐标 → 画布层坐标的偏移
// TopBarReplica 实际渲染为 h-[76px]（px-3 pt-3 + h-14 子内容），故用 76
const TOPBAR_H = 76;

// 端口命中半径（鼠标松开时的吸附范围）
const PORT_HIT_R = 16;

/* ---------- App ---------- */
export default function App() {
  const [instances, setInstances] = useState<NodeInstance[]>(INITIAL_INSTANCES);
  const [selectedId, setSelectedId] = useState<string>("model-1");
  const [glassParams, setGlassParams] = useState<GlassParams>(() => loadStoredParams());
  const [edges, setEdges] = useState<Edge[]>(INITIAL_EDGES);
  const [draftEdge, setDraftEdge] = useState<DraftEdge | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const drag = useRef<{ id: string; start: Point; origin: Point } | null>(null);

  // 用 ref 缓存最新 instances，让回调里读最新值（避免重建监听器）
  const instancesRef = useRef(instances);
  instancesRef.current = instances;

  const getInst = useCallback(
    (id: string): NodeInstance | undefined =>
      instancesRef.current.find((i) => i.id === id),
    [],
  );

  // 在所有实例的端口中找到鼠标命中的那一个
  const hitTestPort = useCallback(
    (p: Point): { instanceId: string; portId: string } | null => {
      for (const inst of instancesRef.current) {
        const def = NODES[inst.type];
        for (const port of def.ports) {
          const a = anchor(inst.position, def, port.id);
          const dx = a.x - p.x;
          const dy = a.y - p.y;
          if (dx * dx + dy * dy < PORT_HIT_R * PORT_HIT_R) {
            return { instanceId: inst.id, portId: port.id };
          }
        }
      }
      return null;
    },
    [],
  );

  // 从端口按下：开始绘制草稿连线，跟随鼠标；松开时落到同色端口则添加 edge
  const startEdge = useCallback(
    (instanceId: string, portId: string, e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const inst = getInst(instanceId);
      if (!inst) return;
      const portDef = NODES[inst.type].ports.find((p) => p.id === portId);
      if (!portDef) return;
      const a = anchor(inst.position, NODES[inst.type], portId);
      const toLocal = (cx: number, cy: number): Point => ({ x: cx, y: cy - TOPBAR_H });

      setDraftEdge({
        fromInstance: instanceId,
        fromPort: portId,
        origin: { x: a.x, y: a.y },
        color: a.color,
        side: portDef.side,
        mouse: toLocal(e.clientX, e.clientY),
      });

      const onMove = (ev: MouseEvent) => {
        setDraftEdge((d) =>
          d ? { ...d, mouse: toLocal(ev.clientX, ev.clientY) } : d,
        );
      };
      const onUp = (ev: MouseEvent) => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        const target = hitTestPort(toLocal(ev.clientX, ev.clientY));
        if (target && target.instanceId !== instanceId) {
          const targetInst = getInst(target.instanceId);
          const targetDef = targetInst
            ? NODES[targetInst.type].ports.find((p) => p.id === target.portId)
            : undefined;
          if (
            targetDef &&
            targetDef.color === portDef.color &&
            targetDef.side !== portDef.side
          ) {
            setEdges((es) => {
              const newEdge: Edge =
                portDef.side === "right"
                  ? { from: [instanceId, portId], to: [target.instanceId, target.portId] }
                  : { from: [target.instanceId, target.portId], to: [instanceId, portId] };
              if (
                es.some(
                  (x) =>
                    x.from[0] === newEdge.from[0] &&
                    x.from[1] === newEdge.from[1] &&
                    x.to[0] === newEdge.to[0] &&
                    x.to[1] === newEdge.to[1],
                )
              ) {
                return es;
              }
              const filtered = es.filter(
                (x) => !(x.to[0] === newEdge.to[0] && x.to[1] === newEdge.to[1]),
              );
              return [...filtered, newEdge];
            });
          }
        }
        setDraftEdge(null);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [getInst, hitTestPort],
  );

  const removeEdge = useCallback((idx: number) => {
    setEdges((es) => es.filter((_, i) => i !== idx));
  }, []);

  const startDrag = useCallback(
    (id: string, e: ReactMouseEvent) => {
      e.preventDefault();
      const inst = getInst(id);
      if (!inst) return;
      setSelectedId(id);
      drag.current = {
        id,
        start: { x: e.clientX, y: e.clientY },
        origin: { ...inst.position },
      };
      const onMove = (ev: MouseEvent) => {
        const d = drag.current;
        if (!d) return;
        setInstances((arr) =>
          arr.map((i) =>
            i.id === d.id
              ? {
                  ...i,
                  position: {
                    x: d.origin.x + (ev.clientX - d.start.x),
                    y: d.origin.y + (ev.clientY - d.start.y),
                  },
                }
              : i,
          ),
        );
      };
      const onUp = () => {
        drag.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [getInst],
  );

  // 右键空白处：弹出"添加节点"菜单
  const onCanvasContextMenu = useCallback((e: ReactMouseEvent) => {
    const target = e.target as HTMLElement;
    // 如果右键命中了某个节点卡（含 data-node-instance），不弹菜单
    if (target.closest("[data-node-instance]")) return;
    e.preventDefault();
    setContextMenu({
      screenX: e.clientX,
      screenY: e.clientY,
      canvasX: e.clientX,
      canvasY: e.clientY - TOPBAR_H,
    });
  }, []);

  const addInstance = useCallback((type: NodeType, canvasX: number, canvasY: number) => {
    const id = `${type}-${Date.now()}`;
    const { w, h } = getCardDims(type);
    setInstances((arr) => [
      ...arr,
      {
        id,
        type,
        // 让卡的中心对准点击位置（鼠标点哪儿卡片中心就在哪儿）
        position: { x: canvasX - w / 2, y: canvasY - h / 2 },
      },
    ]);
    setSelectedId(id);
    setContextMenu(null);
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // 所有实例的 WebGL 玻璃形状（按 TopBar 高 偏移）
  const glassShapes: GlassShape[] = instances.map((inst) => {
    const { w, glassH } = getCardDims(inst.type);
    return {
      centerX: inst.position.x + w / 2,
      centerY: inst.position.y + glassH / 2 + TOPBAR_H,
      width: w,
      height: glassH,
      radius: 32,
    };
  });

  return (
    <div className="relative h-screen overflow-hidden">
      {/* WebGL 液态玻璃层（也承担页面 bg：dot-grid + 三色 glow + 鼠标黄光） */}
      <LiquidGlass shapes={glassShapes} params={glassParams} />

      {/* 左侧悬浮面板：实时调节液态玻璃效果 */}
      <GlassControls params={glassParams} onChange={setGlassParams} />

      <TopBarReplica />

      <div
        className="relative h-[calc(100vh-76px)] overflow-hidden"
        onContextMenu={onCanvasContextMenu}
      >
        {/* 连线层 —— svg 容器整体允许命中事件；空白处不命中 path，事件会穿透 */}
        <svg className="absolute inset-0 z-10 h-full w-full">
          {edges.map((e, i) => {
            const [fId, fPort] = e.from;
            const [tId, tPort] = e.to;
            const fInst = getInst(fId);
            const tInst = getInst(tId);
            if (!fInst || !tInst) return null;
            const from = anchor(fInst.position, NODES[fInst.type], fPort);
            const to = anchor(tInst.position, NODES[tInst.type], tPort);
            return (
              <Wire
                key={`${fId}.${fPort}->${tId}.${tPort}`}
                from={from}
                to={to}
                onDelete={() => removeEdge(i)}
              />
            );
          })}
          {draftEdge && (
            <DraftWire
              from={draftEdge.origin}
              to={draftEdge.mouse}
              color={draftEdge.color}
              fromSide={draftEdge.side}
            />
          )}
        </svg>

        {/* 端口手柄层 —— 每个实例的每个端口一个透明圆 */}
        {instances.flatMap((inst) =>
          NODES[inst.type].ports.map((p) => {
            const a = anchor(inst.position, NODES[inst.type], p.id);
            return (
              <span
                key={`handle-${inst.id}.${p.id}`}
                onMouseDown={(e) => startEdge(inst.id, p.id, e)}
                className="absolute z-30 h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full transition-colors hover:bg-white/[0.08]"
                style={{ left: a.x, top: a.y }}
                title={`${inst.id}.${p.id}`}
              />
            );
          }),
        )}

        {/* 节点层 —— 按实例数组渲染 */}
        {instances.map((inst) => {
          const common = {
            key: inst.id,
            pos: inst.position,
            selected: selectedId === inst.id,
            onSelect: () => setSelectedId(inst.id),
            onDragStart: (e: ReactMouseEvent) => startDrag(inst.id, e),
          };
          switch (inst.type) {
            case "model":          return <ModelNode {...common} />;
            case "prompt":         return <PromptNode {...common} />;
            case "negativePrompt": return <NegativePromptNode {...common} />;
            case "imageGen":       return <ImageGenNode {...common} />;
            case "preview":        return <PreviewNode {...common} />;
          }
        })}

        <CanvasToolbar />

        {/* 右键添加节点菜单 */}
        {contextMenu && (
          <AddNodeMenu
            x={contextMenu.screenX}
            y={contextMenu.screenY}
            onPick={(t) => addInstance(t, contextMenu.canvasX, contextMenu.canvasY)}
            onClose={closeContextMenu}
          />
        )}
      </div>

      <Telemetry />
    </div>
  );
}

// 返回端口的屏幕绝对坐标 + 颜色（连线终点 / 端口 DOM 用同一份）
function anchor(pos: Point, node: NodeDef, portId: string) {
  const port = node.ports.find((p) => p.id === portId);
  if (!port) throw new Error(`port not found: ${node.id}.${portId}`);
  const x = port.side === "left" ? pos.x : pos.x + node.width;
  const y = pos.y + port.top;
  return { x, y, color: port.color };
}

/* ---------- 顶部条（按参考图 1:1 复刻） ---------- */
function TopBarReplica() {
  return (
    <header className="relative z-30 flex h-[76px] items-start px-3 pt-3">
      <nav className="flex items-center gap-1.5">
        <TopBarTab active>Workflow</TopBarTab>
        <TopBarTab>Edit</TopBarTab>
        <TopBarTab>Help</TopBarTab>
      </nav>

      <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2">
        <TopBarIconButton aria-label="Previous project">
          <TopBarChevron dir="left" />
        </TopBarIconButton>
        <TopBarProjectTab />
        <TopBarIconButton aria-label="Next project">
          <TopBarChevron dir="right" />
        </TopBarIconButton>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <TopBarIconButton aria-label="More options">
          <TopBarDots />
        </TopBarIconButton>
        <TopBarQueueButton />
        <TopBarStepper />
        <TopBarIconButton aria-label="Close">
          <TopBarClose />
        </TopBarIconButton>
        <TopBarIconButton aria-label="Snapshot">
          <TopBarCamera />
        </TopBarIconButton>
        <TopBarIconButton aria-label="Menu">
          <TopBarMenu />
        </TopBarIconButton>
      </div>
    </header>
  );

  return (
    <header className="relative z-30 flex h-14 items-center gap-3 px-6">
      {/* 左：螺旋 logo + Workflow/Edit/Help 胶囊 */}
      <Logo />
      <PillTab active>Workflow</PillTab>
      <PillTab>Edit</PillTab>
      <PillTab>Help</PillTab>

      {/* 中：项目 tab 导航（绝对居中，不受左右占位影响） */}
      <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2">
        <SquareBtn aria-label="上一个项目">
          <Chevron dir="left" />
        </SquareBtn>
        <button className="flex items-center gap-2 rounded-full border border-white/[0.04] bg-[#1e1e22] px-4 py-2 text-[13px] font-medium text-white/85 hover:bg-[#23232a]">
          Black bear
          <span className="text-white/35">×</span>
        </button>
        <SquareBtn aria-label="下一个项目">
          <Chevron dir="right" />
        </SquareBtn>
      </div>

      {/* 右：运行控制集群 */}
      <div className="ml-auto flex items-center gap-2">
        <SquareBtn aria-label="更多">
          <DotsVertical />
        </SquareBtn>
        <QueueButton />
        <VStepper />
        <SquareBtn aria-label="关闭">
          <span className="text-[15px] leading-none text-white/65">×</span>
        </SquareBtn>
        <SquareBtn aria-label="截图">
          <CameraIcon />
        </SquareBtn>
        <SquareBtn aria-label="菜单">
          <span className="text-[14px] leading-none text-white/65">≡</span>
        </SquareBtn>
      </div>
    </header>
  );
}

/* 抽象螺旋 logo —— 单色描边 */
function topBarSurface(active = false) {
  return [
    "border border-white/[0.03] bg-[#222225] text-white/78 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]",
    "transition-colors hover:bg-[#29292d] hover:text-white/92",
    active ? "bg-[#262629] text-white/95" : "",
  ].join(" ");
}

function TopBarTab({ children, active = false }: { children: ReactNode; active?: boolean }) {
  return (
    <button
      className={`h-12 min-w-[110px] rounded-[10px] px-6 text-[13px] font-medium ${topBarSurface(active)}`}
    >
      {children}
    </button>
  );
}

function TopBarIconButton({
  children,
  className = "",
  ...rest
}: { children: ReactNode; className?: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`grid h-12 w-12 place-items-center rounded-[10px] ${topBarSurface()} ${className}`}
    >
      {children}
    </button>
  );
}

function TopBarProjectTab() {
  return (
    <button
      className={`flex h-12 min-w-[154px] items-center justify-center gap-4 rounded-[10px] px-5 text-[12px] font-medium ${topBarSurface()}`}
    >
      <span>Black bear</span>
      <TopBarClose size={12} className="text-white/26" />
    </button>
  );
}

function TopBarQueueButton() {
  return (
    <button
      className={`flex h-12 min-w-[144px] items-center justify-center gap-4 rounded-[10px] px-5 text-[14px] font-medium ${topBarSurface()}`}
    >
      <TopBarPlay />
      <span>Queue</span>
      <TopBarChevron dir="down" className="text-white/48" />
    </button>
  );
}

function TopBarStepper() {
  return (
    <div className={`flex h-12 w-10 flex-col items-center justify-center gap-1 rounded-[10px] ${topBarSurface()}`}>
      <button aria-label="Move up" className="grid h-4 w-full place-items-center text-white/45 hover:text-white/80">
        <TopBarChevron dir="up" size={8} />
      </button>
      <button aria-label="Move down" className="grid h-4 w-full place-items-center text-white/45 hover:text-white/80">
        <TopBarChevron dir="down" size={8} />
      </button>
    </div>
  );
}

function TopBarChevron({
  dir,
  size = 10,
  className = "",
}: {
  dir: "up" | "down" | "left" | "right";
  size?: number;
  className?: string;
}) {
  const paths = {
    up: "M 1 7 L 6 2 L 11 7",
    down: "M 1 5 L 6 10 L 11 5",
    left: "M 8 1 L 3 6 L 8 11",
    right: "M 4 1 L 9 6 L 4 11",
  };
  return (
    <svg width={size * 1.2} height={size * 1.2} viewBox="0 0 12 12" className={className}>
      <path d={paths[dir]} fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TopBarPlay() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="text-white/92">
      <path d="M 4.25 2.75 L 12.5 8 L 4.25 13.25 Z" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round" />
    </svg>
  );
}

function TopBarDots() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="text-white/58">
      <circle cx="8" cy="4" r="1.05" fill="currentColor" />
      <circle cx="8" cy="8" r="1.05" fill="currentColor" />
      <circle cx="8" cy="12" r="1.05" fill="currentColor" />
    </svg>
  );
}

function TopBarClose({ size = 16, className = "text-white/58" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className}>
      <path d="M 4.5 4.5 L 11.5 11.5 M 11.5 4.5 L 4.5 11.5" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

function TopBarCamera() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="text-white/58">
      <rect x="3.25" y="4.25" width="9.5" height="8.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path d="M 6 4.25 L 6.75 2.9 H 9.25 L 10 4.25" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      <circle cx="8" cy="8.6" r="2" fill="none" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

function TopBarMenu() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="text-white/58">
      <path d="M 4 5 H 12 M 4 8 H 12 M 4 11 H 12" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

function Logo() {
  return (
    <div className="mr-2 grid h-10 w-10 place-items-center">
      <svg width="28" height="28" viewBox="0 0 28 28" className="text-white">
        <path
          d="M 14 3.5 A 10.5 10.5 0 1 1 3.5 14 A 7 7 0 1 1 14 21 A 3.5 3.5 0 0 1 10.5 17.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

// 顶栏按钮统一灰卡风格 —— 与内层 #1E1E22 卡片完全一致：实色 + hairline，无浮雕、无投影
/* 标签胶囊（Workflow/Edit/Help）*/
function PillTab({ children, active = false }: { children: ReactNode; active?: boolean }) {
  return (
    <button
      className={
        "rounded-full border border-white/[0.04] px-5 py-2 text-[13px] font-medium transition-colors " +
        (active
          ? "bg-[#26262a] text-white/95"
          : "bg-[#1e1e22] text-white/75 hover:bg-[#23232a] hover:text-white/95")
      }
    >
      {children}
    </button>
  );
}

/* 小方按钮（图标用）*/
function SquareBtn({
  children,
  ...rest
}: { children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className="grid h-9 w-9 place-items-center rounded-[10px] border border-white/[0.04] bg-[#1e1e22] text-white/70 hover:bg-[#23232a] hover:text-white"
    >
      {children}
    </button>
  );
}

/* Queue 胶囊：▶ + 文字 + ⌄ */
function QueueButton() {
  return (
    <button className="flex items-center gap-2 rounded-full border border-white/[0.04] bg-[#1e1e22] px-4 py-2 text-[13px] font-medium text-white/90 hover:bg-[#23232a]">
      <svg width="11" height="11" viewBox="0 0 11 11" className="text-white/95">
        <path d="M 2 1.5 L 9.5 5.5 L 2 9.5 Z" fill="currentColor" />
      </svg>
      <span>Queue</span>
      <Chevron dir="down" className="text-white/45" />
    </button>
  );
}

/* 竖向小步进器（上下两个小箭头）*/
function VStepper() {
  return (
    <div className="flex flex-col gap-[1px] overflow-hidden rounded-[8px] border border-white/[0.04] bg-[#1e1e22]">
      <button
        aria-label="上一步"
        className="grid h-[17px] w-6 place-items-center text-white/55 hover:bg-white/[0.05] hover:text-white"
      >
        <Chevron dir="up" size={8} />
      </button>
      <button
        aria-label="下一步"
        className="grid h-[17px] w-6 place-items-center text-white/55 hover:bg-white/[0.05] hover:text-white"
      >
        <Chevron dir="down" size={8} />
      </button>
    </div>
  );
}

/* 通用 chevron 箭头 */
function Chevron({
  dir,
  size = 10,
  className = "",
}: {
  dir: "up" | "down" | "left" | "right";
  size?: number;
  className?: string;
}) {
  const paths = {
    up: "M 1 7 L 6 2 L 11 7",
    down: "M 1 5 L 6 10 L 11 5",
    left: "M 8 1 L 3 6 L 8 11",
    right: "M 4 1 L 9 6 L 4 11",
  };
  return (
    <svg width={size * 1.2} height={size * 1.2} viewBox="0 0 12 12" className={className}>
      <path d={paths[dir]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ⋮ 三个点（垂直） */
function DotsVertical() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="text-white/65">
      <circle cx="7" cy="3" r="1.1" fill="currentColor" />
      <circle cx="7" cy="7" r="1.1" fill="currentColor" />
      <circle cx="7" cy="11" r="1.1" fill="currentColor" />
    </svg>
  );
}

/* 相机图标 */
function CameraIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" className="text-white/65">
      <rect x="2" y="4" width="12" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="8.5" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

/* ---------- 连线（贝塞尔） ----------
   - 连线统一极细灰（DESIGN.md v0.2：不跟端口色，无 glow）。
   - 双击删除：用一条 12px 透明 hitbox 路径接收事件，下方 1px 灰线作可见线。
*/
function Wire({
  from,
  to,
  onDelete,
}: {
  from: Point;
  to: Point;
  onDelete?: () => void;
}) {
  const dx = Math.max(60, (to.x - from.x) / 2);
  const d = `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
  return (
    <g
      onDoubleClick={onDelete}
      style={{ pointerEvents: onDelete ? "stroke" : "none" }}
      className="group cursor-pointer"
    >
      {/* 透明 hitbox：粗 12px 让双击更容易命中 */}
      <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
      {/* 可见线：hover 时变白提示可点 */}
      <path
        d={d}
        fill="none"
        stroke="rgba(255,255,255,0.22)"
        strokeWidth={1}
        className="group-hover:stroke-white/60"
      />
    </g>
  );
}

/* 拖动中的草稿连线 —— 端口色虚线 + 终点小圆点跟随鼠标 */
function DraftWire({
  from,
  to,
  color,
  fromSide,
}: {
  from: Point;
  to: Point;
  color: string;
  fromSide: Side;
}) {
  // 起点的水平控制点方向 = 端口朝外的方向
  const outDir = fromSide === "right" ? 1 : -1;
  const dx = Math.max(60, Math.abs(to.x - from.x) / 2);
  const d = `M ${from.x} ${from.y} C ${from.x + outDir * dx} ${from.y}, ${to.x - outDir * dx} ${to.y}, ${to.x} ${to.y}`;
  return (
    <g style={{ pointerEvents: "none" }}>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray="5 4"
        opacity={0.85}
      />
      <circle cx={to.x} cy={to.y} r={4} fill={color} opacity={0.9} />
    </g>
  );
}

/* NodeCard + Port 已被各节点的自定义 JSX 取代；端口可视化由各节点内部的 InsetPortRow / PortLabelRow 处理。
   Side 类型仍保留作 PortDef.side 的类型约束。 */

/* ---------- Prompt 节点（1:1 参考图 #9）---------- */
function PromptNode({
  pos,
  selected,
  onSelect,
  onDragStart,
}: {
  pos: Point;
  selected: boolean;
  onSelect: () => void;
  onDragStart: (e: ReactMouseEvent) => void;
}) {
  return (
    <div
      data-node-instance
      className="absolute z-20 select-none"
      style={{ left: pos.x, top: pos.y, width: PROMPT_CARD_W, height: PROMPT_CARD_H }}
      onMouseDown={(e) => dragOrSkip(e, onSelect, onDragStart)}
    >
      <div className="relative flex flex-col p-4" style={{ width: PROMPT_CARD_W, height: PROMPT_CARD_H }}>
        {/* 标题行：状态点 + Prompt + 薄荷绿 Generate 胶囊 */}
        <div className="flex shrink-0 items-center justify-between pb-2">
          <div className="flex items-center gap-2.5">
            <StatusDot selected={selected} />
            <span className="text-[15px] font-medium tracking-tight text-white/95">
              Prompt
            </span>
          </div>

          <button className="flex items-center gap-1.5 rounded-full bg-[#7CE38B] px-3 py-1.5 text-[12px] font-medium text-canvas hover:brightness-105">
            <SparkleIcon />
            Generate
          </button>
        </div>

        <PromptSection
          label="Positive"
          color={C.positive}
          currentText="A black bear with a pink snout, minimalist style, soft gradients, clear blue sky"
          placeholder="Type what you want to get"
          className="flex-1"
        />
      </div>
    </div>
  );
}

/* ---------- Negative Prompt 节点（结构与 Prompt 一致） ---------- */
function NegativePromptNode({
  pos,
  selected,
  onSelect,
  onDragStart,
}: {
  pos: Point;
  selected: boolean;
  onSelect: () => void;
  onDragStart: (e: ReactMouseEvent) => void;
}) {
  return (
    <div
      data-node-instance
      className="absolute z-20 select-none"
      style={{ left: pos.x, top: pos.y, width: NEGATIVE_PROMPT_CARD_W, height: NEGATIVE_PROMPT_CARD_H }}
      onMouseDown={(e) => dragOrSkip(e, onSelect, onDragStart)}
    >
      <div className="relative flex flex-col p-4" style={{ width: NEGATIVE_PROMPT_CARD_W, height: NEGATIVE_PROMPT_CARD_H }}>
        {/* 标题行：状态点 + Negative + 珊瑚红 Generate 胶囊 */}
        <div className="flex shrink-0 items-center justify-between pb-2">
          <div className="flex items-center gap-2.5">
            <StatusDot selected={selected} />
            <span className="text-[15px] font-medium tracking-tight text-white/95">
              Negative
            </span>
          </div>

          <button className="flex items-center gap-1.5 rounded-full bg-[#FF7E87] px-3 py-1.5 text-[12px] font-medium text-canvas hover:brightness-105">
            <SparkleIcon />
            Generate
          </button>
        </div>

        <PromptSection
          label="Negative"
          color={C.negative}
          currentText="No text, unnecessary details, background objects, other animals or people."
          placeholder="Type what do not you want to get"
          className="flex-1"
        />
      </div>
    </div>
  );
}

/* 通用拖动入口：先选中，再判断 target 是否在 input/textarea/button 内；
   不在控件上才启动拖动（避免拖动时无法点击/输入）*/
function dragOrSkip(
  e: ReactMouseEvent,
  onSelect: () => void,
  onDragStart: (e: ReactMouseEvent) => void,
) {
  onSelect();
  const target = e.target as HTMLElement;
  if (target.closest("input, textarea, button")) return;
  onDragStart(e);
}

/* Prompt 卡内的复用子卡（Positive / Negative 同款结构）*/
function PromptSection({
  label,
  color,
  currentText,
  placeholder,
  className = "",
}: {
  label: string;
  color: string;
  currentText: string;
  placeholder: string;
  className?: string;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div
      className={`rounded-[20px] border border-white/[0.04] p-4 ${className}`}
      style={{ background: "#1e1e22" }}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
        />
        <span className="text-[14px] font-medium text-white/95">{label}</span>
        <span
          className="ml-auto h-2 w-2 rounded-full"
          style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
        />
      </div>

      <p className="mt-3 text-[12px] leading-relaxed text-white/70">{currentText}</p>

      <div
        className="mt-3 rounded-[14px] border border-white/[0.04] px-3.5 py-2.5"
        style={{ background: "#141418" }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent text-[12px] text-white/85 placeholder:text-white/35 focus:outline-none"
        />
      </div>
    </div>
  );
}

/* 节点状态点：未选中=空心白圆环；选中=实心白圆点 */
function StatusDot({ selected }: { selected: boolean }) {
  return selected ? (
    <span className="h-3.5 w-3.5 rounded-full bg-white/90" />
  ) : (
    <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-white/85" />
  );
}

/* ✦ Sparkle icon for Generate button */
function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <path d="M7 0 L8.1 5.9 L14 7 L8.1 8.1 L7 14 L5.9 8.1 L0 7 L5.9 5.9 Z" />
    </svg>
  );
}

/* ---------- Image Generator 节点（1:1 参考图 #11）---------- */
function ImageGenNode({
  pos,
  selected,
  onSelect,
  onDragStart,
}: {
  pos: Point;
  selected: boolean;
  onSelect: () => void;
  onDragStart: (e: ReactMouseEvent) => void;
}) {
  return (
    <div
      data-node-instance
      className="absolute z-20 select-none"
      style={{ left: pos.x, top: pos.y, width: IMAGE_GEN_CARD_W, height: IMAGE_GEN_CARD_H }}
      onMouseDown={(e) => dragOrSkip(e, onSelect, onDragStart)}
    >
      <div
        className="relative flex flex-col p-4"
        style={{ width: IMAGE_GEN_CARD_W, height: IMAGE_GEN_CARD_H }}
      >
        {/* 标题 */}
        <div className="flex shrink-0 items-center gap-2.5 pb-2">
          <StatusDot selected={selected} />
          <span className="text-[15px] font-medium tracking-tight text-white/95">
            Image Generator
          </span>
        </div>

        {/* 一整张内灰容器（flex-1 撑满） */}
        <div
          className="flex flex-1 flex-col rounded-[20px] border border-white/[0.04] p-4"
          style={{ background: "#1e1e22" }}
        >
          {/* 端口区 */}
          <div className="flex items-start justify-between">
            <div className="space-y-1.5">
              <PortLabelRow label="model" color={C.model} side="left" />
              <PortLabelRow label="positive" color={C.positive} side="left" />
              <PortLabelRow label="negative" color={C.negative} side="left" />
            </div>
            <PortLabelRow label="image" color={C.image} side="right" />
          </div>

          {/* 参数列表 */}
          <div className="mt-5 space-y-2.5">
            <ParamRow label="Randomness" value="12345" />
            <ParamRow label="Control mode" value="Fixed" />
            <ParamRow label="Quality steps">
              <StepperControl value={30} />
            </ParamRow>
            <ParamRow label="Prompt strength" value="8.0" />
            <ParamRow label="Sampling method" value="dpm++ 2M" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* 端口标签行 —— 支持左右两种朝向（点 / 标签的顺序对换） */
function PortLabelRow({
  label,
  color,
  side,
}: {
  label: string;
  color: string;
  side: "left" | "right";
}) {
  const dot = (
    <span
      className="h-2 w-2 rounded-full"
      style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
    />
  );
  return (
    <div className="flex items-center gap-2 text-[12px] text-white/55">
      {side === "left" ? (
        <>
          {dot}
          <span>{label}</span>
        </>
      ) : (
        <>
          <span>{label}</span>
          {dot}
        </>
      )}
    </div>
  );
}

/* 参数行：左标签 + 右控件 */
// 参数行：左 label 自然宽，右控件容器固定宽（所有行对齐到同一右列）
const PARAM_CTRL_W = 116;

function ParamRow({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex-1 whitespace-nowrap text-[12px] text-white/65">{label}</span>
      <div style={{ width: PARAM_CTRL_W }}>
        {children ?? <ParamValueCard value={value ?? ""} />}
      </div>
    </div>
  );
}

function ParamValueCard({ value }: { value: string }) {
  return (
    <button
      className="flex h-8 w-full items-center justify-between gap-2 rounded-[10px] border border-white/[0.04] px-2.5 hover:brightness-110"
      style={{ background: "#141418" }}
    >
      <span className="text-[12px] text-white/85">{value}</span>
      <Chevron dir="down" size={8} className="text-white/40" />
    </button>
  );
}

function StepperControl({ value }: { value: number }) {
  return (
    <div className="flex h-8 w-full items-center gap-1.5">
      <button
        aria-label="减"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-white/[0.04] hover:brightness-110"
        style={{ background: "#141418" }}
      >
        <Chevron dir="left" size={8} className="text-white/70" />
      </button>
      <div
        className="grid h-8 flex-1 place-items-center rounded-[10px] border border-white/[0.04]"
        style={{ background: "#141418" }}
      >
        <span className="tnum text-[12px] text-white/85">{value}</span>
      </div>
      <button
        aria-label="加"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-white/[0.04] hover:brightness-110"
        style={{ background: "#141418" }}
      >
        <Chevron dir="right" size={8} className="text-white/70" />
      </button>
    </div>
  );
}

/* ---------- Preview 节点 ---------- */
/* ---------- Preview Image 节点（1:1 参考图 #13）---------- */
function PreviewNode({
  pos,
  selected,
  onSelect,
  onDragStart,
}: {
  pos: Point;
  selected: boolean;
  onSelect: () => void;
  onDragStart: (e: ReactMouseEvent) => void;
}) {
  return (
    <div
      data-node-instance
      className="absolute z-20 select-none"
      style={{ left: pos.x, top: pos.y, width: PREVIEW_CARD_W, height: PREVIEW_CARD_H }}
      onMouseDown={(e) => dragOrSkip(e, onSelect, onDragStart)}
    >
      {/* 玻璃覆盖区域：标题 + 主灰卡（flex 列，灰卡 flex-1 撑满到玻璃底） */}
      <div
        className="relative flex flex-col p-4"
        style={{ width: PREVIEW_CARD_W, height: PREVIEW_GLASS_H }}
      >
        {/* 标题：状态点 + Preview Image */}
        <div className="flex shrink-0 items-center gap-2.5 pb-2">
          <StatusDot selected={selected} />
          <span className="text-[15px] font-medium tracking-tight text-white/95">
            Preview Image
          </span>
        </div>

        {/* 主灰卡：image 端口 + 生成图（flex-1 向下撑满父级玻璃区域） */}
        <div
          className="flex flex-1 flex-col rounded-[20px] border border-white/[0.04] p-4"
          style={{ background: "#1e1e22" }}
        >
          {/* image 端口标签 */}
          <div className="flex items-center gap-2 pb-3 text-[12px] text-white/55">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: C.image, boxShadow: `0 0 6px ${C.image}` }}
            />
            <span>image</span>
          </div>

          {/* 生成图：演示图 = 内联 SVG 极简黑熊插画 + 描述文字叠加 */}
          <div
            className="relative flex-1 overflow-hidden rounded-[14px]"
            style={{ background: "#0a0a0d" }}
          >
            <DemoBearArtwork />

            {/* 底部暗化让文字可读 */}
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />

            {/* 文字叠加：Final Result + 描述 */}
            <div className="absolute inset-x-0 bottom-0 p-4">
              <h3 className="text-[17px] font-medium tracking-tight text-white drop-shadow-sm">
                Final Result
              </h3>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-white/80">
                Minimalist illustration of a black bear with a pink snout, soft
                gradients, and smooth shapes, against a clear blue sky
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 操作栏 —— 独立浮在父级玻璃下方（不被玻璃覆盖） */}
      <div
        className="mx-4 flex h-12 items-center gap-1 rounded-[14px] border border-white/[0.06] p-[5px]"
        style={{ marginTop: PREVIEW_BAR_GAP, background: "#1f1f22" }}
      >
        <IconAction title="放大">
          <ExpandIcon />
        </IconAction>
        <IconAction title="收藏">
          <BookmarkIcon />
        </IconAction>
        <IconAction title="复制">
          <CopyIcon />
        </IconAction>
        <IconAction title="重新生成">
          <RefreshIcon />
        </IconAction>
        <DropdownChip value="2x" />
        <DropdownChip value="PNG" />
        <IconAction title="下载">
          <DownloadIcon />
        </IconAction>
      </div>
    </div>
  );
}

/* ---------- 右键"添加节点"菜单 ---------- */
function AddNodeMenu({
  x,
  y,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  onPick: (type: NodeType) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      // 点菜单内部不关
      if ((e.target as HTMLElement).closest("[data-context-menu]")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // 用 mousedown 而不是 click，避免被节点的 mousedown 抢先
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // 防止溢出视口右下：菜单宽 ~200、高 ~270
  const left = Math.min(x, window.innerWidth - 220);
  const top = Math.min(y, window.innerHeight - 290);

  return (
    <div
      data-context-menu
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 min-w-[200px] overflow-hidden rounded-[12px] border border-white/[0.08] p-1.5 shadow-[0_24px_60px_rgba(0,0,0,0.6)] backdrop-blur-xl"
      style={{ left, top, background: "rgba(28, 28, 32, 0.92)" }}
    >
      <div className="px-2.5 pb-1.5 pt-1 text-[10px] uppercase tracking-wider text-white/40">
        Add node
      </div>
      {NODE_TYPE_LIST.map((item) => (
        <button
          key={item.type}
          onClick={() => onPick(item.type)}
          className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13px] text-white/85 hover:bg-white/[0.06] hover:text-white"
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: item.color, boxShadow: `0 0 6px ${item.color}` }}
          />
          {item.label}
        </button>
      ))}
    </div>
  );
}

/* 演示图：内联 SVG 极简黑熊（粉鼻 + 蓝天背景），与 Final Result 描述一致 */
function DemoBearArtwork() {
  return (
    <svg
      viewBox="0 0 200 280"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
    >
      <defs>
        <linearGradient id="bg-sky" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="#FFE0B5" />
          <stop offset="25%" stopColor="#FFB1C8" />
          <stop offset="55%" stopColor="#B8E5FF" />
          <stop offset="100%" stopColor="#3F5A85" />
        </linearGradient>
        <radialGradient id="bg-aura" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="white" stopOpacity="0.45" />
          <stop offset="60%" stopColor="white" stopOpacity="0.08" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="bear-fill" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="#403048" />
          <stop offset="60%" stopColor="#1E1828" />
          <stop offset="100%" stopColor="#0A0610" />
        </linearGradient>
      </defs>
      {/* 天空 + 光晕 */}
      <rect width="200" height="280" fill="url(#bg-sky)" />
      <rect width="200" height="280" fill="url(#bg-aura)" />
      {/* 身体 */}
      <ellipse cx="100" cy="225" rx="78" ry="55" fill="url(#bear-fill)" />
      {/* 头 */}
      <ellipse cx="100" cy="155" rx="58" ry="48" fill="url(#bear-fill)" />
      {/* 耳朵 */}
      <circle cx="62" cy="120" r="22" fill="url(#bear-fill)" />
      <circle cx="138" cy="120" r="22" fill="url(#bear-fill)" />
      <circle cx="62" cy="120" r="9" fill="#3A2A45" opacity="0.65" />
      <circle cx="138" cy="120" r="9" fill="#3A2A45" opacity="0.65" />
      {/* 粉鼻区 */}
      <ellipse cx="100" cy="172" rx="22" ry="13" fill="#FFB1C8" opacity="0.92" />
      <circle cx="100" cy="166" r="4" fill="#16101F" />
      {/* 眼睛 */}
      <ellipse cx="84" cy="148" rx="3" ry="3.6" fill="#FFE5D0" />
      <ellipse cx="116" cy="148" rx="3" ry="3.6" fill="#FFE5D0" />
      <circle cx="84" cy="148" r="1.4" fill="#16101F" />
      <circle cx="116" cy="148" r="1.4" fill="#16101F" />
    </svg>
  );
}

/* 操作栏的图标按钮（h-8 w-8 深灰小卡） */
function IconAction({ children, title }: { children: ReactNode; title: string }) {
  return (
    <button
      aria-label={title}
      className="grid h-8 w-8 place-items-center rounded-[8px] border border-white/[0.035] bg-[#151518] text-white/58 hover:bg-[#1b1b1f] hover:text-white/85"
    >
      {children}
    </button>
  );
}

/* 操作栏的下拉块（"2x ⌄" / "PNG ⌄"） */
function DropdownChip({ value }: { value: string }) {
  return (
    <button className="flex h-8 min-w-[48px] items-center justify-center gap-1 rounded-[8px] border border-white/[0.035] bg-[#151518] px-2 text-[11px] font-medium text-white/78 hover:bg-[#1b1b1f] hover:text-white/92">
      <span>{value}</span>
      <Chevron dir="down" size={8} className="text-white/45" />
    </button>
  );
}

function ExpandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M3 6 V3 H6 M10 3 H13 V6 M13 10 V13 H10 M6 13 H3 V10" />
    </svg>
  );
}
function BookmarkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M4 2.5 H12 V13.5 L8 10.5 L4 13.5 Z" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M11 5 V3.5 a1 1 0 0 0 -1 -1 H3.5 a1 1 0 0 0 -1 1 V10 a1 1 0 0 0 1 1 H5" />
    </svg>
  );
}
function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7 A5 5 0 0 1 13 6.5" />
      <path d="M13 3 V7 H9" />
      <path d="M13 9 A5 5 0 0 1 3 9.5" />
      <path d="M3 13 V9 H7" />
    </svg>
  );
}
function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3 V11" />
      <path d="M4.5 7.5 L8 11 L11.5 7.5" />
      <path d="M3 13.5 H13" />
    </svg>
  );
}

/* ---------- Model 节点（1:1 复刻参考图） ---------- */
function ModelNode({
  pos,
  selected,
  onSelect,
  onDragStart,
}: {
  pos: Point;
  selected: boolean;
  onSelect: () => void;
  onDragStart: (e: ReactMouseEvent) => void;
}) {
  const def = NODES.model;
  return (
    <div
      data-node-instance
      className="absolute z-20 select-none"
      style={{ left: pos.x, top: pos.y, width: def.width }}
      onMouseDown={(e) => dragOrSkip(e, onSelect, onDragStart)}
    >
      <div
        className="relative flex flex-col p-4"
        style={{ width: MODEL_CARD_W, height: MODEL_CARD_H }}
      >
        {/* 标题 */}
        <div className="flex shrink-0 items-center gap-2.5 pb-2">
          <StatusDot selected={selected} />
          <span className="text-[15px] font-medium tracking-tight text-white/95">
            Model
          </span>
        </div>

        {/* 灰色容器卡 —— flex-1 撑满父级剩余高度 */}
        <div
          className="flex flex-1 flex-col rounded-[20px] border border-white/[0.04] p-4"
          style={{ background: "#1e1e22" }}
        >
          <div className="ml-auto w-max space-y-1.5 text-right">
            <InsetPortRow label="model" color={C.model} />
            <InsetPortRow label="positive" color={C.positive} />
            <InsetPortRow label="negative" color={C.negative} />
          </div>

          {/* Dropdown 子卡 */}
          <div
            className="relative mt-4 flex items-center justify-between rounded-[14px] border border-white/[0.04] px-3 py-2"
            style={{ background: "#141418" }}
          >
            <span className="text-[12px] font-medium text-white/90">
              DreamShaper 6 (SD1.5)
            </span>
            <button className="grid h-7 w-7 place-items-center rounded-[8px] bg-[#0a0a0d] text-white/85">
              <Chevron dir="down" size={9} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InsetPortRow({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex items-center justify-end gap-2.5 text-[13px] text-white/55">
      <span>{label}</span>
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
      />
    </div>
  );
}


/* ---------- 画布右侧工具栏 ---------- */
function CanvasToolbar() {
  return (
    <div className="absolute right-4 top-1/2 z-20 -translate-y-1/2 space-y-1.5">
      {["+", "−", "⤢", "👁"].map((s) => (
        <button
          key={s}
          className="grid h-8 w-8 place-items-center rounded-md border border-white/[0.06] bg-white/[0.04] text-[13px] text-white/70 hover:bg-white/[0.08] hover:text-white"
        >
          {s}
        </button>
      ))}
    </div>
  );
}

/* ---------- 右下角遥测块 ---------- */
function Telemetry() {
  return (
    <div className="pointer-events-none absolute bottom-5 right-6 z-20 space-y-0.5 text-right text-[11px] tnum text-white/35">
      <div>T: 0.00s</div>
      <div>I: 0</div>
      <div>N: 10 (10)</div>
      <div>S: 60.24</div>
    </div>
  );
}
