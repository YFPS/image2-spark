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
  RefObject,
} from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { LiquidGlass, type GlassShape } from "./LiquidGlass";
import { RecentWorksCard } from "./components/RecentWorksCard";
import { GalleryPage } from "./pages/GalleryPage";
import { LogsPage } from "./pages/LogsPage";
import { useRecentWorks } from "./hooks/useRecentWorks";
import { GlassControls, loadStoredParams, type GlassParams } from "./GlassControls";
import {
  generateImages,
  editImage,
  imageToSrc,
  safeImageSrc,
  GenerateError,
  type GenerateImage as ApiImage,
  type GenerateUsage as ApiUsage,
} from "./api/gptImage";
import { StickerCropperModal, ScissorsIcon } from "./components/StickerCropperModal";
import { MaskBrushModal } from "./components/MaskBrushModal";
import { AiCutoutModal } from "./components/AiCutoutModal";
import ModelPlaza from "./ModelPlaza";
import { useAuth } from "./auth/AuthContext";
import { useConversations } from "./conversation/useConversations";
import { HistoryDropdown } from "./conversation/HistoryDropdown";
import { TimelineQuickJump } from "./conversation/TimelineQuickJump";
import { conversationHasPendingGeneration } from "./conversation/pendingGeneration";
import { extractConversationResults } from "./conversation/conversationResults";

// 角色 → 侧边栏副标显示
const ROLE_LABEL: Record<"admin" | "user" | "paid", string> = {
  admin: "管理员",
  user: "免费用户",
  paid: "付费用户",
};

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
const GENERATE_CARD_RADIUS = 28;

/* ---------- 类型 & 数据 ---------- */
type Point = { x: number; y: number };
type Side = "left" | "right";
type AppMode = "generate" | "workflow";
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
  { type: "model",          label: "模型",           color: C.model },
  { type: "prompt",         label: "提示词",          color: C.positive },
  { type: "negativePrompt", label: "负面提示词", color: C.negative },
  { type: "imageGen",       label: "图像生成器", color: C.image },
  { type: "preview",        label: "预览图像",   color: C.image },
];

// 顶部条占用的高度，鼠标坐标 → 画布层坐标的偏移
// TopBarReplica 实际渲染为 h-[76px]（px-3 pt-3 + h-14 子内容），故用 76
const TOPBAR_H = 76;

// 端口命中半径（鼠标松开时的吸附范围）
const PORT_HIT_R = 16;

/* ---------- App ---------- */
export default function App() {
  const [mode, setMode] = useState<AppMode>("generate");
  const [instances, setInstances] = useState<NodeInstance[]>(INITIAL_INSTANCES);
  const [selectedId, setSelectedId] = useState<string>("model-1");
  const [glassParams, setGlassParams] = useState<GlassParams>(() => loadStoredParams());
  const [generateGlassShapes, setGenerateGlassShapes] = useState<GlassShape[]>([]);
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
  const glassShapes: GlassShape[] =
    mode === "workflow"
      ? instances.map((inst) => {
          const { w, glassH } = getCardDims(inst.type);
          return {
            centerX: inst.position.x + w / 2,
            centerY: inst.position.y + glassH / 2 + TOPBAR_H,
            width: w,
            height: glassH,
            radius: GENERATE_CARD_RADIUS,
          };
        })
      : generateGlassShapes;

  return (
    <div className="relative h-screen overflow-hidden">
      {/* WebGL 液态玻璃层（也承担页面 bg：dot-grid + 三色 glow + 鼠标黄光） */}
      <LiquidGlass shapes={glassShapes} params={glassParams} />

      {/* 左侧悬浮面板：仅在节点工作流里调节液态玻璃节点效果 */}
      {mode === "workflow" && (
        <GlassControls params={glassParams} onChange={setGlassParams} />
      )}

      <TopBarReplica mode={mode} onModeChange={setMode} />

      {mode === "generate" ? (
        <SimpleGenerateView onShapesChange={setGenerateGlassShapes} />
      ) : (
        <>
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
        </>
      )}
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

function SimpleGenerateView({
  onShapesChange,
}: {
  onShapesChange: (shapes: GlassShape[]) => void;
}) {
  const { user } = useAuth();
  const recentWorks = useRecentWorks();
  // 七张外层玻璃壳：左侧栏、参考图、参数、结果、最近作品、AI 对话、历史时间轴
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const referenceCardRef = useRef<HTMLDivElement | null>(null);
  const settingsCardRef = useRef<HTMLDivElement | null>(null);
  const resultsCardRef = useRef<HTMLDivElement | null>(null);
  const recentCardRef = useRef<HTMLDivElement | null>(null);
  const chatPanelRef = useRef<HTMLDivElement | null>(null);
  // 聊天消息滚动容器 —— TimelineQuickJump 用它读 scrollTop 算"当前消息"并 scrollTo 跳转
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [activeNav, setActiveNav] = useState("studio");
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  // ModelPlaza 内部自管选型；这里只读 selectedModel 用于顶部副标显示
  const [selectedModel] = useState<"gpt-image-2" | "banana-nano-pro">("gpt-image-2");
  const [chatInput, setChatInput] = useState("");

  // 出图状态
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [results, setResults] = useState<ApiImage[]>([]);
  const [usage, setUsage] = useState<ApiUsage | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [cropperSrc, setCropperSrc] = useState<string | null>(null);
  const [aiCutoutSrc, setAiCutoutSrc] = useState<string | null>(null);

  // 对话气泡数据：派生自 useConversations()
  // 服务端 message → UI ChatMsg；进行中的 AI 回复用本地 pendingBubble 占位
  type ChatMsg = {
    id: number | string;
    role: "ai" | "user";
    text: string;
    created_at?: string;
    // 来自后端 message.status，决定 ChatBubble 渲染骨架 / 红字 / 缩略图
    status?: "done" | "pending" | "failed";
    pending?: boolean;
    // 生图任务的产出图（done 后渲染缩略图）
    image_urls?: string[] | null;
    // 来自 params.request.size，决定 pending 骨架的宽高比（如 "1024x1024"）
    size?: string;
  };
  const conversations = useConversations();
  // 监听当前会话内 AI done 计数上涨 → 实时刷新最近作品
  // 切换会话时（convId 变化）只更新基线、不触发 refresh
  const recentWorksDoneRef = useRef<{ convId: number | null; count: number }>({
    convId: null,
    count: 0,
  });
  useEffect(() => {
    const currentConv = conversations.current;
    const convId = currentConv?.id ?? null;
    const doneCount = (currentConv?.messages ?? []).filter(
      (m) =>
        m.role === "ai" &&
        m.status === "done" &&
        (m.image_urls?.length ?? 0) > 0,
    ).length;

    const prev = recentWorksDoneRef.current;
    if (prev.convId === convId && doneCount > prev.count) {
      void recentWorks.refresh();
    }
    recentWorksDoneRef.current = { convId, count: doneCount };
    // recentWorks 整体每次 setState 都是新引用；只依赖稳定的 refresh（useCallback 内）即可
  }, [conversations.current, recentWorks.refresh]);
  const [pendingBubble, setPendingBubble] = useState<ChatMsg | null>(null);
  const DEFAULT_GREET: ChatMsg = {
    id: "greet",
    role: "ai",
    text: "你好，把你想生成的画面打在下方输入框里，回车即可出图。",
  };
  const chatMessages: ChatMsg[] = (() => {
    const base: ChatMsg[] = conversations.current
      ? conversations.current.messages.map((m) => {
          // params.request.size 形如 "1024x1024" / "auto"；用于推断 pending 骨架比例
          const reqSize = (m.params as { request?: { size?: string } } | null)?.request?.size;
          return {
            id: m.id,
            role: m.role,
            text: m.text,
            created_at: m.created_at,
            status: m.status,
            pending: m.status === "pending",
            image_urls: m.image_urls,
            size: reqSize,
          };
        })
      : [];
    const out: ChatMsg[] = base.length === 0 ? [DEFAULT_GREET] : base;
    // 仍保留 pendingBubble 作为本地占位通道（极少数场景：调 API 还没回 pending message 之前）
    return pendingBubble ? [...out, pendingBubble] : out;
  })();

  // gpt-image-2 受控参数
  // quality 默认 low：上游通道慢，先求快出图；用户可自行切到 high
  const [quality, setQuality] = useState("low");
  const [ratio, setRatio] = useState("1:1");
  const [resolution, setResolution] = useState("1K");
  const [n, setN] = useState("1");
  const [background, setBackground] = useState("auto");
  const [format, setFormat] = useState("png");
  const [compression, setCompression] = useState(80);
  const [moderation, setModeration] = useState("auto");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [customW, setCustomW] = useState(1024);
  const [customH, setCustomH] = useState(1024);

  // 模式：generate / edit / reasoning
  const [mode, setMode] = useState<"generate" | "edit" | "reasoning">("generate");
  // Edit 模式下需要记住最后一张生成的图片 src
  const [lastResultSrc, setLastResultSrc] = useState<string | null>(null);
  // 参考图：支持多张；refImages[0] 与 refMaskBlob 对齐（mask 仅作用于第 1 张）
  type RefItem = { id: string; dataURL: string };
  const [refImages, setRefImages] = useState<RefItem[]>([]);
  const [refDragOver, setRefDragOver] = useState(false);
  // 参考图卡 hover 态：默认折叠堆叠，悬停展开有间距
  const refFileInputRef = useRef<HTMLInputElement | null>(null);
  // 参考图配套的 inpainting 蒙版（OpenAI 协议：alpha=0=AI 重画）
  const [refMaskBlob, setRefMaskBlob] = useState<Blob | null>(null);
  const [maskModalOpen, setMaskModalOpen] = useState(false);

  // 兼容旧逻辑的别名 / 上限
  const refImage = refImages[0]?.dataURL ?? null;
  const REF_MAX = 10;
  const REF_FOLDED_LIMIT = 5;
  const foldedRefImages = refImages.slice(0, REF_FOLDED_LIMIT);
  const foldedHiddenCount = Math.max(0, refImages.length - REF_FOLDED_LIMIT);
  const handleRefFiles = useCallback((files: FileList | File[] | null | undefined) => {
    if (!files) return;
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) return;
    Promise.all(
      list.map(
        (f) =>
          new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve(typeof reader.result === "string" ? reader.result : null);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(f);
          }),
      ),
    ).then((dataUrls) => {
      const items = dataUrls
        .filter((u): u is string => !!u)
        .map((u, i) => ({
          id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
          dataURL: u,
        }));
      setRefImages((prev) => {
        // 若原本无图，新上传的第 0 张会成为新的"主图"，旧 mask 失效
        if (prev.length === 0 && items.length > 0) setRefMaskBlob(null);
        return [...prev, ...items].slice(0, REF_MAX);
      });
    });
  }, []);

  const clearRefs = useCallback(() => {
    setRefImages([]);
    setRefMaskBlob(null);
  }, []);

  // 自定义尺寸校验（gpt-image-2 约束）
  const customSizeError = ratio === "custom" ? validateCustomSize(customW, customH) : null;
  // 选中"自定"自动展开高级设置区
  useEffect(() => {
    if (ratio === "custom") setAdvancedOpen(true);
  }, [ratio]);
  // 由 ratio + resolution 推导出实际 size（用于 API 提交 + 显示）
  const effectiveSize =
    ratio === "auto"
      ? "auto"
      : ratio === "custom"
        ? customSizeError
          ? null
          : `${customW}×${customH}`
        : (SIZE_TABLE[ratio]?.[resolution] ?? null);
  const displaySize =
    ratio === "auto"
      ? "自动"
      : ratio === "custom"
        ? customSizeError
          ? "无效尺寸"
          : `${customW}×${customH}`
        : (effectiveSize ?? "—");
  // 分辨率行是否禁用
  const resolutionDisabled = ratio === "auto" || ratio === "custom";

  const hasServerPending = conversationHasPendingGeneration(conversations.current);
  const isGenerating = loading || hasServerPending;
  // 未验证邮箱用户禁止生成（后端有 403 兜底，这里提前 disable 避免无效请求）
  const verificationRequired = user?.verification_required ?? false;
  const canGenerate =
    !isGenerating && (ratio !== "custom" || customSizeError == null) && chatInput.trim().length > 0
    && (mode !== "edit" || lastResultSrc != null)
    && !verificationRequired;

  const handleGenerate = async () => {
    const prompt = chatInput.trim();
    if (!prompt || isGenerating) return;

    if (verificationRequired) {
      setErrorMsg("请先验证邮箱后再生成图片");
      return;
    }

    // 确保有一个 conversation：没有就立刻在服务端创建一个空 session
    let convId = conversations.currentId;
    if (convId == null) {
      try {
        const conv = await conversations.createConversation();
        convId = conv.id;
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "创建会话失败");
        return;
      }
    }

    if (ratio === "custom" && customSizeError) {
      // 校验失败也持久化（user + ai 错误），保持历史完整
      void conversations.appendMessage(convId, { role: "user", text: prompt });
      void conversations.appendMessage(convId, { role: "ai", text: `无法生成：${customSizeError}` });
      setChatInput("");
      return;
    }
    const apiSize = (effectiveSize ?? "auto").toString();
    setChatInput("");
    // 发送消息后自动滚动到最新消息位置
    requestAnimationFrame(() => {
      const el = chatScrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
    setLoading(true);
    setErrorMsg(null);
    setPendingBubble({ id: "pending-local", role: "ai", text: "提交中…", pending: true });
    try {
      // 先确认 user message 已落库；刷新恢复时，服务端历史不会缺 prompt。
      await conversations.appendMessage(convId, { role: "user", text: prompt });
      const count = Math.max(1, Number(n));
      if (mode === "edit") {
        // Edit 模式：优先用 refImages（多图），否则降级到上一次生成的图
        const sources: string[] =
          refImages.length > 0 ? refImages.map((r) => r.dataURL) : lastResultSrc ? [lastResultSrc] : [];
        if (sources.length === 0) {
          throw new Error("没有可修改的图片，请上传参考图或先用「生成」模式出一张");
        }
        const imageBlobs = await Promise.all(
          sources.map((src) => fetch(src).then((r) => r.blob())),
        );
        // mask 对齐第 1 张
        let maskBlob: Blob;
        if (refImages.length > 0 && refMaskBlob) {
          maskBlob = refMaskBlob;
        } else {
          const bitmap = await createImageBitmap(imageBlobs[0]);
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          maskBlob = await new Promise<Blob>((resolve) =>
            canvas.toBlob((b) => resolve(b!), "image/png"),
          );
          bitmap.close();
        }

        // 任务化：每次 n=1 并发 count 次，后端立刻返回 pending ai message
        const pendings = await Promise.all(
          Array.from({ length: count }, () =>
            editImage(
              {
                imageBlobs,
                maskBlob,
                prompt,
                size: apiSize !== "auto" ? apiSize : undefined,
                quality,
                n: 1,
              },
              convId!,
            ),
          ),
        );
        // attach 进 current.messages，触发 useConversations 的 hasPending 轮询
        pendings.forEach((m) => conversations.attachMessage(convId!, m));
      } else {
        // 任务化：每次 n=1 并发 count 次
        const pendings = await Promise.all(
          Array.from({ length: count }, () =>
            generateImages(
              {
                model: "gpt-image-2",
                prompt,
                size: apiSize,
                quality,
                n: 1,
                background,
                output_format: format,
                output_compression: format !== "png" ? compression : undefined,
                moderation,
                reasoning: mode === "reasoning",
              },
              convId!,
            ),
          ),
        );
        pendings.forEach((m) => conversations.attachMessage(convId!, m));
      }
    } catch (e) {
      const msg =
        e instanceof GenerateError
          ? `${e.apiError.code}：${e.apiError.message}`
          : e instanceof Error
            ? e.message
            : String(e);
      setErrorMsg(msg);
      void conversations.appendMessage(convId, { role: "ai", text: `失败：${msg}` });
    } finally {
      // 拿到 pending message attach 后，本地占位作用结束 —— 消息渲染由 current.messages 接管
      setPendingBubble(null);
      setLoading(false);
    }
  };

  // 从当前会话的最新一轮 user prompt 后面的 done AI 消息恢复预览区。
  // 这让刷新后已完成的任务也能填充预览，而不是只依赖 pending → done 的瞬时变化。
  useEffect(() => {
    const { images, usage } = extractConversationResults(conversations.current);
    setResults(images);
    setUsage(usage);
    const firstSrc = images[0] ? imageToSrc(images[0], format) : null;
    if (firstSrc) setLastResultSrc(firstSrc);
  }, [conversations.current, format]);

  // 模式切换时清理
  const handleModeChange = (newMode: "generate" | "edit" | "reasoning") => {
    setMode(newMode);
  };

  useLayoutEffect(() => {
    // 当 activeNav 不是 "studio" 时（models/gallery/logs），由对应页面主导玻璃 shape，
    // MainCanvas 的 7 张玻璃壳测量跳过；同时清空 shapes，避免上次工作室的影子残留。
    if (activeNav !== "studio") {
      onShapesChange([]);
      return;
    }
    const refs: RefObject<HTMLElement | null>[] = [
      sidebarRef,
      referenceCardRef,
      settingsCardRef,
      resultsCardRef,
      recentCardRef,
      chatPanelRef,
    ];
    const measure = () => {
      const shapes = refs
        .map((ref) => ref.current)
        .filter((el): el is HTMLElement => el !== null)
        .map((el) => rectToGlassShape(el.getBoundingClientRect()));
      onShapesChange(shapes);
    };

    const raf = requestAnimationFrame(measure);
    const onResize = () => requestAnimationFrame(measure);
    const observer = new ResizeObserver(() => requestAnimationFrame(measure));
    refs.forEach((ref) => {
      if (ref.current) observer.observe(ref.current);
    });
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [onShapesChange, activeNav]);

  return (
    <main className="relative z-20 h-[calc(100vh-76px)] overflow-hidden">
      <div className="flex h-full gap-3 px-3 pb-4 pt-3">
        {/* 左侧导航栏（可展开） */}
        <aside
          ref={sidebarRef}
          className="flex shrink-0 flex-col rounded-[28px] px-2.5 py-4 transition-[width] duration-200"
          style={{ width: sidebarExpanded ? 220 : 72 }}
        >
          {/* Logo 行 */}
          <div
            className={`flex items-center ${
              sidebarExpanded ? "justify-between gap-2 px-1" : "justify-center"
            }`}
          >
            <div className="flex min-w-0 items-center gap-2">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-accent-foxo text-[14px] font-semibold text-[#0D0D0D]">
                ✦
              </div>
              {sidebarExpanded && (
                <span className="truncate text-[14px] font-semibold tracking-tight text-white/92">
                  Mona
                </span>
              )}
            </div>
            {sidebarExpanded && (
              <button
                onClick={() => setSidebarExpanded(false)}
                title="收起"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] text-white/50 hover:bg-white/[0.06] hover:text-white/85"
              >
                <ChevronIcon direction="left" />
              </button>
            )}
          </div>

          {/* 收起态：切换按钮独立成一行居中 */}
          {!sidebarExpanded && (
            <button
              onClick={() => setSidebarExpanded(true)}
              title="展开"
              className="mx-auto mt-3 grid h-6 w-11 place-items-center rounded-[10px] bg-white/[0.04] text-white/55 hover:bg-white/[0.08] hover:text-white/90"
            >
              <ChevronIcon direction="right" />
            </button>
          )}

          {/* 导航项 */}
          <div className="mt-4 flex flex-col gap-1">
            {SIDEBAR_ITEMS.map((it) => (
              <SidebarItem
                key={it.key}
                icon={it.icon}
                label={it.label}
                active={activeNav === it.key}
                expanded={sidebarExpanded}
                onClick={() => setActiveNav(it.key)}
              />
            ))}
          </div>

          <div className="flex-1" />

          {/* 底部：设置 + 头像 */}
          <SidebarItem icon={<GearIcon />} label="设置" expanded={sidebarExpanded} />

          <div
            className={`mt-3 flex items-center gap-2 rounded-[14px] border border-white/[0.04] bg-white/[0.03] ${
              sidebarExpanded ? "px-2.5 py-2" : "h-11 w-11 justify-center self-center"
            }`}
          >
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-foxo/20 text-[12px] font-semibold text-accent-foxo">
              {(user?.nickname || user?.email || "?").slice(0, 1).toUpperCase()}
            </div>
            {sidebarExpanded && (
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[12px] font-medium text-white/86">
                  {user?.nickname ?? "未登录"}
                </span>
                <span className="truncate text-[10px] text-white/40">
                  {user ? ROLE_LABEL[user.role] : "—"}
                </span>
              </div>
            )}
          </div>
        </aside>

        {activeNav === "models" ? (
          <ModelPlaza onShapesChange={onShapesChange} />
        ) : activeNav === "gallery" ? (
          <GalleryPage onPreview={(src) => setPreviewSrc(src)} />
        ) : activeNav === "logs" ? (
          <LogsPage onPreview={(src) => setPreviewSrc(src)} />
        ) : (
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* 顶部标题（贴外、不进卡） */}
          <div className="flex shrink-0 items-center justify-between gap-3 px-1">
            <div className="flex items-center gap-3">
              <StatusDot selected />
              <h1 className="text-[22px] font-medium leading-tight text-white/95">图像生成</h1>
              <span className="text-[12px] text-white/45">借助 AI 创作画面 · {selectedModel === "gpt-image-2" ? "gpt-image-2" : "banana-nano-pro"}</span>
            </div>
            <div className="flex items-center gap-2">
              <button className="rounded-full bg-white/[0.04] px-3 py-1.5 text-[12px] font-medium text-white/72 hover:bg-white/[0.08]">
                我的模板
              </button>
              <button className="rounded-full bg-accent-foxo px-3.5 py-1.5 text-[12px] font-semibold text-[#0D0D0D] shadow-generate-glow">
                + 新建项目
              </button>
            </div>
          </div>

          {/* 主区：左（紧凑参考图 + 大参数卡）| 右（结果） */}
          <div className="grid min-h-0 flex-1 grid-cols-[360px_1fr] gap-3">
            {/* 左列：参考图紧凑条 + 参数撑满 */}
            <div className="flex min-h-0 flex-col gap-3">
              {/* 参考图：默认折叠最多 5 张；鼠标悬停整块 → 缩略图整体上浮 */}
              <div
                ref={referenceCardRef}
                className="group relative shrink-0 rounded-[24px]"
              >
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (!refDragOver) setRefDragOver(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setRefDragOver(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setRefDragOver(false);
                    handleRefFiles(e.dataTransfer.files);
                  }}
                  className={`relative h-[176px] overflow-hidden rounded-[22px] border px-5 pb-4 pt-4 transition-all ${
                    refDragOver
                      ? "border-accent-foxo/70 bg-accent-foxo/[0.07] ring-2 ring-accent-foxo/25"
                      : "border-white/[0.14] bg-[#0b0b0f]/30 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.025),0_0_30px_rgba(158,38,116,0.14)] hover:border-white/[0.24]"
                  }`}
                >
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_28%_8%,rgba(143,24,92,0.30),transparent_42%),radial-gradient(circle_at_66%_100%,rgba(210,182,27,0.16),transparent_34%)]" />
                  <div className="pointer-events-none absolute inset-x-8 bottom-0 h-px bg-gradient-to-r from-transparent via-accent-foxo/45 to-transparent" />
                  <input
                    ref={refFileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      handleRefFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />

                  <div className="relative z-10 flex items-start justify-between gap-2">
                    <span className="text-[13px] font-semibold text-[#ffe7bd] drop-shadow-[0_0_10px_rgba(247,176,91,0.30)]">
                      {refDragOver ? "松开以上传" : "参考图（折叠状态）"}
                    </span>
                    {refImage && (
                      <div className="flex items-center gap-1.5 opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100">
                        <button
                          title={refMaskBlob ? "已涂抹 · 点击重新编辑蒙版" : "涂抹要修改的区域（仅作用于主图）"}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMaskModalOpen(true);
                          }}
                          className={`grid h-7 w-7 place-items-center rounded-[10px] border text-[12px] transition-colors ${
                            refMaskBlob
                              ? "border-accent-foxo/40 bg-accent-foxo/10 text-accent-foxo"
                              : "border-white/[0.04] bg-[#141418] text-white/55 hover:bg-[#16161a]"
                          }`}
                        >
                          <BrushIcon />
                        </button>
                        <button
                          title={refImages.length > 1 ? "清空全部" : "移除"}
                          onClick={(e) => {
                            e.stopPropagation();
                            clearRefs();
                          }}
                          className="grid h-7 w-7 place-items-center rounded-[10px] border border-white/[0.04] bg-[#141418] text-[12px] text-white/55 hover:bg-[#16161a]"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="relative z-10 mt-5 flex h-[76px] items-center gap-2 pl-1 transition-transform duration-200 ease-out group-hover:-translate-y-1.5">
                    {foldedRefImages.length === 0 && (
                      <button
                        title="添加参考图（支持多选）"
                        onClick={() => refFileInputRef.current?.click()}
                        className="flex h-[68px] w-full items-center gap-3 rounded-[14px] border border-dashed border-white/[0.18] bg-white/[0.025] px-4 text-left transition-all hover:border-accent-foxo/70 hover:bg-accent-foxo/[0.04]"
                      >
                        <span className="grid h-11 w-11 place-items-center rounded-[12px] bg-white/[0.05] text-[24px] leading-none text-white/[0.58]">
                          +
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="text-[13px] font-medium text-white/80">上传参考图</span>
                          <span className="mt-0.5 text-[11px] text-white/[0.42]">可拖拽或点击上传，支持多张</span>
                        </span>
                      </button>
                    )}

                    {foldedRefImages.map((item, idx) => (
                      <div
                        key={item.id}
                        title="点击放大预览"
                        onClick={() => setPreviewSrc(item.dataURL)}
                        className="group/thumb relative h-[72px] w-[54px] shrink-0 cursor-zoom-in overflow-hidden rounded-[10px] border border-white/[0.14] bg-[#141418] shadow-[0_14px_28px_-6px_rgba(0,0,0,0.55),0_4px_10px_rgba(0,0,0,0.38),inset_0_0_0_1px_rgba(255,255,255,0.08)] transition-[border-color,box-shadow,transform] duration-200 ease-out -skew-x-12 hover:-translate-y-0.5 hover:border-accent-foxo/60 hover:shadow-[0_16px_30px_-4px_rgba(247,200,11,0.45),0_4px_10px_rgba(0,0,0,0.4),inset_0_0_0_1px_rgba(247,200,11,0.42)]"
                      >
                        <img
                          src={item.dataURL}
                          alt={`参考图 ${idx + 1}`}
                          className="h-full w-full object-cover skew-x-12 scale-125"
                          draggable={false}
                        />
                        {/* 玻璃膜：斜向高光 + 顶部亮边 + 左侧亮边 + 底部暗化 */}
                        <div className="pointer-events-none absolute inset-0 rounded-[10px]">
                          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.34)_0%,rgba(255,255,255,0.10)_26%,rgba(255,255,255,0.02)_50%,transparent_62%)]" />
                          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/35 to-transparent" />
                          <div className="absolute inset-x-1.5 top-0 h-px bg-gradient-to-r from-transparent via-white/55 to-transparent" />
                          <div className="absolute inset-y-1.5 left-0 w-px bg-gradient-to-b from-white/45 via-white/10 to-transparent" />
                        </div>
                      </div>
                    ))}
                    {refImages.length < REF_MAX && foldedRefImages.length > 0 && (
                      <button
                        title={
                          foldedHiddenCount > 0
                            ? `还有 ${foldedHiddenCount} 张，点击继续添加`
                            : "添加参考图（支持多选）"
                        }
                        onClick={() => refFileInputRef.current?.click()}
                        className="group/add ml-1 grid h-[72px] w-[54px] shrink-0 place-items-center rounded-[10px] border border-dashed border-white/[0.18] bg-white/[0.015] text-[22px] font-light leading-none text-white/45 transition-[border-color,background-color,color,transform] duration-200 ease-out -skew-x-12 hover:-translate-y-1 hover:border-accent-foxo/60 hover:bg-accent-foxo/[0.04] hover:text-accent-foxo"
                      >
                        +
                      </button>
                    )}
                  </div>

                  <div className="relative z-10 mt-3 text-[11px] font-medium text-white/[0.42]">
                    {refImages.length === 0
                      ? "可选 · 拖拽或点击上传（支持多张）"
                      : `默认折叠显示 ${REF_FOLDED_LIMIT} 张，悬停展开查看全部`}
                  </div>
                </div>

              </div>

              {/* 参数卡（撑满左列） */}
              <div
                ref={settingsCardRef}
                className="flex min-h-0 flex-1 flex-col rounded-[28px] p-5"
              >
              <div className="mb-3 flex shrink-0 items-center justify-between">
                <span className="text-[13px] font-medium text-white/92">参数</span>
                <span className="text-[11px] text-white/35">gpt-image-2</span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto rounded-[20px] border border-white/[0.04] bg-[#1e1e22] p-4 [scrollbar-color:rgba(255,255,255,0.16)_transparent] [scrollbar-width:thin] [scrollbar-gutter:stable]">
                {/* 比例：7 段，使用堆叠版式（标签在上、segmented 全宽）以容纳 16:9/9:16 */}
                <div className="mb-2.5">
                  <div className="mb-1.5 text-[11px] text-white/45">比例</div>
                  <PillGroup
                    value={ratio}
                    onChange={setRatio}
                    options={[
                      { value: "auto", label: "自动" },
                      { value: "1:1", label: "1:1" },
                      { value: "16:9", label: "16:9" },
                      { value: "9:16", label: "9:16" },
                      { value: "2:3", label: "2:3" },
                      { value: "3:2", label: "3:2" },
                      { value: "custom", label: "自定" },
                    ]}
                  />
                </div>

                <SettingsGroup label="分辨率">
                  <PillGroup
                    value={resolution}
                    onChange={setResolution}
                    disabled={resolutionDisabled}
                    options={[
                      { value: "1K", label: "1K" },
                      { value: "2K", label: "2K" },
                      { value: "4K", label: "4K" },
                    ]}
                  />
                </SettingsGroup>

                <SettingsGroup label="质量">
                  <PillGroup
                    value={quality}
                    onChange={setQuality}
                    options={["auto", "low", "medium", "high"].map((v) => ({
                      value: v,
                      label: v,
                    }))}
                  />
                </SettingsGroup>

                <SettingsGroup label="数量">
                  <PillGroup
                    value={n}
                    onChange={setN}
                    options={["1", "2", "4", "6", "8", "10"].map((v) => ({ value: v, label: v }))}
                  />
                </SettingsGroup>

                <SettingsGroup label="背景">
                  <PillGroup
                    value={background}
                    onChange={setBackground}
                    options={[
                      { value: "auto", label: "自动" },
                      { value: "opaque", label: "不透明" },
                    ]}
                  />
                </SettingsGroup>

                <SettingsGroup label="格式">
                  <PillGroup
                    value={format}
                    onChange={setFormat}
                    options={["png", "jpeg", "webp"].map((v) => ({
                      value: v,
                      label: v.toUpperCase(),
                    }))}
                  />
                </SettingsGroup>

                <button
                  onClick={() => setAdvancedOpen((v) => !v)}
                  className="mt-1 flex w-full items-center justify-between rounded-[14px] border border-white/[0.04] bg-[#141418] px-4 py-3 text-[12px] text-white/68 hover:bg-[#16161a]"
                >
                  <span>高级设置</span>
                  <span className={`transition-transform ${advancedOpen ? "rotate-180" : ""}`}>
                    ▾
                  </span>
                </button>

                {advancedOpen && (
                  <div className="mt-3 space-y-3">
                    {/* 自定义尺寸（仅当比例选中"自定义"时显示） */}
                    {ratio === "custom" && (
                      <div
                        className={`rounded-[14px] border bg-[#141418] px-4 py-3 ${
                          customSizeError ? "border-red-500/40" : "border-white/[0.04]"
                        }`}
                      >
                        <div className="mb-2 flex items-center justify-between text-[11px] text-white/45">
                          <span>自定义尺寸</span>
                          <span className="tnum text-white/55">px · 16 倍数 · ≤3840</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={customW}
                            onChange={(e) => setCustomW(Number(e.target.value))}
                            className={`min-w-0 flex-1 rounded-[10px] bg-[#0E0E11] px-3 py-2 text-[12px] text-white/86 outline-none ring-1 ring-inset ${
                              customSizeError ? "ring-red-500/50" : "ring-white/[0.06]"
                            }`}
                          />
                          <span className="text-white/40">×</span>
                          <input
                            type="number"
                            value={customH}
                            onChange={(e) => setCustomH(Number(e.target.value))}
                            className={`min-w-0 flex-1 rounded-[10px] bg-[#0E0E11] px-3 py-2 text-[12px] text-white/86 outline-none ring-1 ring-inset ${
                              customSizeError ? "ring-red-500/50" : "ring-white/[0.06]"
                            }`}
                          />
                        </div>
                        {customSizeError && (
                          <p className="mt-2 text-[11px] text-red-400/85">{customSizeError}</p>
                        )}
                      </div>
                    )}

                    <SettingsGroup label="审核">
                      <PillGroup
                        value={moderation}
                        onChange={setModeration}
                        options={[
                          { value: "auto", label: "auto" },
                          { value: "low", label: "low" },
                        ]}
                      />
                    </SettingsGroup>

                    {/* 流式开关（当前中转商不支持 SSE，整块置灰 + 提示） */}
                    <div
                      title="当前中转接口不支持 SSE 流式传输（探针验证 Content-Type 为 application/json），切换无效"
                      className="cursor-not-allowed rounded-[14px] border border-white/[0.04] bg-[#141418] px-4 py-3 opacity-45"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                          <span className="flex items-center gap-1.5 text-[12px] text-white/86">
                            流式生成
                            <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9.5px] text-white/55">
                              暂不可用
                            </span>
                          </span>
                          <span className="text-[10.5px] text-white/40">
                            当前接口不支持 · 待中转商提供 SSE 透传后启用
                          </span>
                        </div>
                        <button
                          disabled
                          className="relative h-5 w-9 shrink-0 cursor-not-allowed rounded-full bg-white/[0.10]"
                        >
                          <span className="absolute left-0.5 top-0.5 h-4 w-4 translate-x-0 rounded-full bg-white/60 shadow" />
                        </button>
                      </div>
                    </div>

                    {format !== "png" && (
                      <div className="rounded-[14px] border border-white/[0.04] bg-[#141418] px-4 py-3">
                        <div className="flex items-center justify-between text-[11px] text-white/45">
                          <span>压缩率</span>
                          <span className="tnum text-white/72">{compression}</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={compression}
                          onChange={(e) => setCompression(Number(e.target.value))}
                          className="mt-2 w-full accent-accent-foxo"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 右列：结果 */}
          <div
            ref={resultsCardRef}
            className="flex min-h-0 flex-col rounded-[28px] p-5"
          >
            <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-[13px] font-medium text-white/92">结果</span>
                <span className="flex items-center gap-1.5 text-[11px] text-white/42">
                  {mode === "edit" && (
                    <span className="rounded-full bg-accent-foxo/12 px-1.5 py-0.5 text-[10px] text-accent-foxo">修改</span>
                  )}
                  {mode === "reasoning" && (
                    <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-white/60">思考</span>
                  )}
                  {n} 张 · {displaySize} · {quality}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <MetricChip label="In" value={usage ? String(usage.input_tokens) : "—"} />
                <MetricChip label="Out" value={usage ? String(usage.output_tokens) : "—"} />
                <MetricChip label="Total" value={usage ? String(usage.total_tokens) : "—"} />
                <button
                  disabled={!results.length}
                  className="rounded-full bg-white/[0.04] px-3 py-1.5 text-[12px] font-medium text-white/68 hover:bg-white/[0.08] disabled:opacity-40"
                >
                  下载
                </button>
                <button
                  disabled={!results.length}
                  className="rounded-full bg-white px-3 py-1.5 text-[12px] font-medium text-[#0D0D0D] disabled:opacity-40"
                >
                  分享
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1">
              {isGenerating ? (
                <div className="grid h-full place-items-center rounded-[20px] border border-white/[0.04] bg-[#111114]">
                  <div className="flex flex-col items-center gap-3 text-white/55">
                    <Spinner />
                    <span className="text-[12px]">正在生成…</span>
                  </div>
                </div>
              ) : errorMsg && results.length === 0 ? (
                <div className="grid h-full place-items-center rounded-[20px] border border-red-500/30 bg-[#1a0e10] px-6 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-[13px] font-medium text-red-400">生成失败</span>
                    <span className="max-w-[640px] truncate text-[12px] text-white/55">
                      {errorMsg}
                    </span>
                  </div>
                </div>
              ) : results.length === 0 ? (
                <div className="grid h-full place-items-center rounded-[20px] border border-dashed border-white/[0.06] bg-[#0E0E11] text-[12px] text-white/35">
                  在右侧聊天框输入提示词，回车开始你的第一张作品
                </div>
              ) : (
                <ResultGallery
                  images={results}
                  format={format}
                  onPreview={setPreviewSrc}
                  onCropper={setCropperSrc}
                  onAiCutout={setAiCutoutSrc}
                />
              )}
            </div>
          </div>
        </div>

        {/* 最近作品横滑 —— 受控组件，items/loading 由 App 层的 useRecentWorks 单例提供 */}
        <RecentWorksCard
          ref={recentCardRef}
          items={recentWorks.items}
          loading={recentWorks.loading}
          onPreview={(src) => setPreviewSrc(src)}
        />

        </div>
        )}

        {activeNav !== "models" && (
        <>
        {/* 右侧 AI 对话面板 */}
        <aside
          ref={chatPanelRef}
          className="flex shrink-0 flex-col gap-3 rounded-[28px] p-4"
          style={{ width: 340 }}
        >
          <div className="relative flex shrink-0 items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-accent-foxo/15 text-accent-foxo">
                <SparkleIcon />
              </span>
              <span className="text-[13px] font-medium text-white/92">AI 助手</span>
            </div>
            <div className="relative flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => conversations.setCurrentId(null)}
                title="新对话"
                aria-label="新对话"
                className="grid h-7 w-7 place-items-center rounded-full text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white/92"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setHistoryOpen((v) => !v)}
                title="历史记录"
                aria-label="历史记录"
                aria-expanded={historyOpen}
                className="grid h-7 w-7 place-items-center rounded-full text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white/92"
                style={{ color: historyOpen ? "rgba(255,255,255,0.92)" : undefined, background: historyOpen ? "rgba(255,255,255,0.06)" : undefined }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </button>
              {historyOpen && (
                <HistoryDropdown
                  items={conversations.list}
                  currentId={conversations.currentId}
                  loading={conversations.loadingList}
                  onSelect={(id) => conversations.setCurrentId(id)}
                  onRename={conversations.rename}
                  onTogglePin={conversations.togglePin}
                  onDelete={conversations.remove}
                  onClose={() => setHistoryOpen(false)}
                />
              )}
            </div>
          </div>

          {/* 消息区 */}
          <div
            ref={chatScrollRef}
            className="min-h-0 flex-1 overflow-y-auto rounded-[20px] border border-white/[0.04] bg-[#1e1e22] p-3 [scrollbar-color:rgba(255,255,255,0.16)_transparent] [scrollbar-width:thin] [scrollbar-gutter:stable]"
          >
            <div className="space-y-3 text-[12.5px] leading-relaxed">
              {chatMessages.map((m) => (
                // wrapper 标 data-msg-id：TimelineQuickJump 用它 query 节点并 scrollTo
                <div key={m.id} data-msg-id={m.id}>
                  <ChatBubble
                    role={m.role}
                    pending={m.pending}
                    status={m.status}
                    imageUrls={m.image_urls}
                    size={m.size}
                    onImageClick={(src) => setPreviewSrc(src)}
                  >
                    {m.text}
                  </ChatBubble>
                </div>
              ))}
            </div>
          </div>

          {/* 模式选择 + 输入条 */}
          <div className="flex shrink-0 flex-col gap-2">
            {/* 模式选择 */}
            <div className="flex items-center gap-1 rounded-[14px] border border-white/[0.04] bg-[#141418] p-[3px]">
              {[
                { value: "generate", label: "生成", icon: <SparkleSmallIcon /> },
                { value: "edit", label: "修改", icon: <EditIcon /> },
                { value: "reasoning", label: "思考", icon: <BrainIcon /> },
              ].map((opt) => {
                const active = mode === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => handleModeChange(opt.value as typeof mode)}
                    className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[11px] px-2 py-2 text-[12px] font-medium transition-colors ${
                      active
                        ? "bg-accent-foxo/14 text-accent-foxo ring-1 ring-inset ring-accent-foxo/30"
                        : "text-white/55 hover:bg-white/[0.04] hover:text-white/85"
                    }`}
                  >
                    {opt.icon}
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* 模式状态提示 */}
            {mode === "edit" && (
              <div className="flex items-center gap-2 rounded-[12px] bg-accent-foxo/8 px-3 py-2 text-[11px] text-white/65">
                <EditIcon />
                <span>
                  {refImage
                    ? refMaskBlob
                      ? "Inpainting：仅重绘涂抹区域"
                      : "将基于上传的参考图整张重绘 · 点笔刷涂抹可只改局部"
                    : lastResultSrc
                      ? "基于上一次生成结果进行修改"
                      : "暂无图片可修改，请上传参考图或先生成一张"}
                </span>
              </div>
            )}
            {mode === "reasoning" && (
              <div className="flex items-center gap-2 rounded-[12px] bg-white/[0.03] px-3 py-2 text-[11px] text-white/65">
                <BrainIcon />
                <span>思考模式：模型会花更多时间推理，生成更高质量的结果</span>
              </div>
            )}

            {/* 输入条 */}
            <div className="flex shrink-0 items-center gap-2 rounded-[18px] border border-white/[0.04] bg-[#141418] px-3 py-2">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleGenerate();
                  }
                }}
                placeholder={
                  isGenerating
                    ? "生成中…"
                    : mode === "edit"
                      ? "描述你想如何修改图片，回车修改"
                      : mode === "reasoning"
                        ? "描述你想生成的画面（思考模式），回车出图"
                        : "描述你想生成的画面，回车出图"
                }
                disabled={isGenerating}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-white/90 placeholder:text-white/32 focus:outline-none disabled:opacity-50"
              />
              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                title={
                  canGenerate
                    ? "出图"
                    : isGenerating
                      ? "生成中"
                      : verificationRequired
                        ? "请先验证邮箱后再生成图片"
                        : "输入提示词后回车"
                }
                className="grid h-8 w-8 place-items-center rounded-full bg-accent-foxo text-[#0D0D0D] disabled:opacity-40"
              >
                {isGenerating ? <Spinner small /> : <SendIcon />}
              </button>
            </div>
          </div>
        </aside>
        {/* 快速跳转时间轴 —— 透明无背景，紧贴 AI 卡片右侧；tick = 当前会话内的一条 message */}
        <TimelineQuickJump
          messages={chatMessages.filter((m) => typeof m.id === "number")}
          scrollContainerRef={chatScrollRef}
        />
        </>
        )}
      </div>

      {/* 图片预览遮罩 */}
      {previewSrc && <ImagePreviewModal src={previewSrc} onClose={() => setPreviewSrc(null)} />}

      {/* 抠图工具 */}
      {cropperSrc && (
        <StickerCropperModal src={cropperSrc} onClose={() => setCropperSrc(null)} />
      )}

      {/* AI 抠图工具（笔刷涂主体 → AI 重绘为透明背景） */}
      {aiCutoutSrc && (
        <AiCutoutModal imageSrc={aiCutoutSrc} onClose={() => setAiCutoutSrc(null)} />
      )}

      {/* Inpainting 蒙版编辑 */}
      {maskModalOpen && refImage && (
        <MaskBrushModal
          imageSrc={refImage}
          initialMask={refMaskBlob}
          onSave={(blob) => {
            setRefMaskBlob(blob);
            setMaskModalOpen(false);
          }}
          onClose={() => setMaskModalOpen(false)}
        />
      )}
    </main>
  );
}

/* 参数分组：标签在左、分段控件在右，整体对齐成表格行 */
function SettingsGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-center gap-3 last:mb-0">
      <div className="w-10 shrink-0 text-[11px] text-white/45">{label}</div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/* 等宽分段控件（segmented control） */
function PillGroup({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <div
      className={`flex w-full rounded-full border border-white/[0.04] bg-[#141418] p-[3px] transition-opacity ${
        disabled ? "pointer-events-none opacity-45" : ""
      }`}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => !disabled && onChange(opt.value)}
            className={`min-w-0 flex-1 rounded-full px-1.5 py-1.5 text-center text-[12px] font-medium transition-colors ${
              active
                ? "bg-white/[0.10] text-white/95 ring-1 ring-inset ring-white/15"
                : "text-white/55 hover:bg-white/[0.04] hover:text-white/85"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* 内联指标小芯片 */
function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-white/[0.04] px-2.5 py-1 text-[11px]">
      <span className="text-white/40">{label}</span>
      <span className="tnum text-white/82">{value}</span>
    </div>
  );
}

/* ---------- 侧栏 / 聊天 ---------- */
const SIDEBAR_ITEMS: ReadonlyArray<{ key: string; label: string; icon: ReactNode }> = [
  { key: "studio",  label: "工作室", icon: <StudioIcon /> },
  { key: "gallery", label: "画廊",   icon: <GalleryIcon /> },
  { key: "models",  label: "模型",   icon: <ModelsIcon /> },
  { key: "logs",    label: "日志",   icon: <HistoryIcon /> },
];

function SidebarItem({
  icon,
  label,
  active,
  expanded,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  expanded?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={expanded ? undefined : label}
      className={`group relative flex h-11 items-center rounded-[14px] transition-colors ${
        expanded ? "w-full gap-3 px-3" : "w-11 justify-center self-center"
      } ${
        active
          ? "bg-white/[0.08] text-white/95"
          : "text-white/55 hover:bg-white/[0.04] hover:text-white/85"
      }`}
    >
      {/* 选中态左侧黄色竖条 */}
      {active && (
        <span className="pointer-events-none absolute left-1 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-accent-foxo shadow-[0_0_8px_rgba(204,255,0,0.55)]" />
      )}
      <span
        className={`grid h-5 w-5 shrink-0 place-items-center transition-colors ${
          active ? "text-accent-foxo" : ""
        }`}
      >
        {icon}
      </span>
      {expanded && <span className="truncate text-[13px] font-medium">{label}</span>}
    </button>
  );
}

function ChevronIcon({ direction = "right" }: { direction?: "left" | "right" }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: direction === "left" ? "rotate(180deg)" : "none" }}
    >
      <path d="M6 3l5 5-5 5" />
    </svg>
  );
}

function ChatBubble({
  role,
  pending,
  status,
  imageUrls,
  size,
  onImageClick,
  children,
}: {
  role: "ai" | "user";
  pending?: boolean;
  status?: "done" | "pending" | "failed";
  /** done 后的产出图：直接在 bubble 内渲染缩略图（点击放大走 onImageClick） */
  imageUrls?: string[] | null;
  /** 生图任务的请求 size，如 "1024x1024"；用于 done 时缩略图比例 */
  size?: string;
  onImageClick?: (src: string) => void;
  children: ReactNode;
}) {
  const isUser = role === "user";
  const isFailed = status === "failed";
  // pending：本地占位（pending=true）或服务端 message.status='pending'
  const showPending = !isUser && (pending || status === "pending");
  const hasImages = !isUser && status === "done" && imageUrls && imageUrls.length > 0;
  const aspect = parseSizeAspect(size);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[88%] rounded-[14px] ${
          isUser
            ? "bg-accent-foxo/14 text-white/92 ring-1 ring-inset ring-accent-foxo/30 px-3 py-2"
            : isFailed
              ? "bg-[#2a1818] text-[#FF8A8A] ring-1 ring-inset ring-[#FF8A8A]/30 px-3 py-2"
              : hasImages
                ? "bg-[#141418] text-white/82 ring-1 ring-inset ring-white/[0.04] p-2"
                : showPending
                  ? "thinking-shimmer text-white/82 ring-1 ring-inset ring-white/[0.06] px-3 py-2"
                  : "bg-[#141418] text-white/82 ring-1 ring-inset ring-white/[0.04] px-3 py-2"
        }`}
      >
        {showPending ? (
          <span className="flex items-center gap-2">
            <ThinkingDots />
            <span className="thinking-text">{children || "生成中"}</span>
          </span>
        ) : hasImages ? (
          <div className="flex flex-col gap-1.5">
            <div className={imageUrls!.length === 1 ? "" : "grid grid-cols-2 gap-1.5"}>
              {imageUrls!.map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => onImageClick?.(safeImageSrc(u))}
                  className="block overflow-hidden rounded-[10px] ring-1 ring-inset ring-white/[0.06] transition-transform hover:scale-[1.02]"
                  style={{ aspectRatio: aspect }}
                >
                  <img
                    src={safeImageSrc(u)}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                </button>
              ))}
            </div>
            {children && <div className="px-1 text-[11px] text-white/55">{children}</div>}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/** 把 "WxH" 或 "auto" 转成 CSS aspect-ratio 字符串 */
function parseSizeAspect(size?: string): string {
  if (!size || size === "auto") return "1 / 1";
  const m = size.replace("×", "x").match(/^(\d+)x(\d+)$/);
  if (!m) return "1 / 1";
  return `${m[1]} / ${m[2]}`;
}

/** "思考中"三连小圆点：交错跳动 */
function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="thinking-dot" style={{ animationDelay: "0ms" }} />
      <span className="thinking-dot" style={{ animationDelay: "180ms" }} />
      <span className="thinking-dot" style={{ animationDelay: "360ms" }} />
    </span>
  );
}

/* 侧栏图标（极简描边） */
function StudioIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11l7-7 7 7" />
      <path d="M5 9v7a1 1 0 0 0 1 1h3v-5h2v5h3a1 1 0 0 0 1-1V9" />
    </svg>
  );
}
function GalleryIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="14" height="14" rx="2" />
      <circle cx="7" cy="8" r="1.4" />
      <path d="M17 13l-4-4-7 7" />
    </svg>
  );
}
function ModelsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="14" height="4" rx="1.2" />
      <rect x="3" y="12" width="14" height="4" rx="1.2" />
    </svg>
  );
}
function HistoryIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l2.5 2" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="2.4" />
      <path d="M16.5 10a6.5 6.5 0 0 0-.1-1.1l1.5-1.1-1.3-2.2-1.7.6a6.5 6.5 0 0 0-1.9-1.1L12.7 3h-2.6l-.3 2.1a6.5 6.5 0 0 0-1.9 1.1l-1.7-.6L4.9 7.8l1.5 1.1a6.5 6.5 0 0 0 0 2.2L4.9 12.2l1.3 2.2 1.7-.6a6.5 6.5 0 0 0 1.9 1.1l.3 2.1h2.6l.3-2.1a6.5 6.5 0 0 0 1.9-1.1l1.7.6 1.3-2.2-1.5-1.1c.07-.36.1-.73.1-1.1z" />
    </svg>
  );
}
function Spinner({ small }: { small?: boolean }) {
  const size = small ? 14 : 22;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M12 3a9 9 0 0 1 9 9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 真实出图 tile：优先 url；否则 b64_json → data URI；hover 时露出操作按钮 */
function ResultImage({
  img,
  format,
  large,
  onPreview,
  onCropper,
  onAiCutout,
}: {
  img: ApiImage;
  format: string;
  large?: boolean;
  onPreview?: (src: string) => void;
  onCropper?: (src: string) => void;
  onAiCutout?: (src: string) => void;
}) {
  const rawSrc = imageToSrc(img, format);
  const src = rawSrc ? safeImageSrc(rawSrc) : null;
  const downloadSrc = rawSrc || null;
  return (
    <article
      className={`group relative w-full overflow-hidden rounded-[20px] border border-white/[0.05] bg-[#111114] ${
        large ? "h-full" : "h-full min-h-[180px]"
      }`}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-contain" draggable={false} />
      ) : (
        <div className="grid h-full place-items-center text-[12px] text-white/35">无图像数据</div>
      )}

      {src && (
        <div className="absolute right-3 top-3 z-20 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={() => onCropper?.(src)}
            title="抠图（ML 框选）"
            className="grid h-9 w-9 place-items-center rounded-full border border-white/[0.10] bg-[#17171b]/82 text-white/82 backdrop-blur-md hover:bg-[#1e1e22]"
          >
            <ScissorsIcon />
          </button>
          <button
            onClick={() => onAiCutout?.(src)}
            title="AI 抠图（笔刷涂主体 · 重绘透明背景）"
            className="grid h-9 w-9 place-items-center rounded-full border border-accent-foxo/40 bg-accent-foxo/12 text-accent-foxo backdrop-blur-md hover:bg-accent-foxo/20"
          >
            <SparkleSmallIcon />
          </button>
          <button
            onClick={() => onPreview?.(src)}
            title="放大预览"
            className="grid h-9 w-9 place-items-center rounded-full border border-white/[0.10] bg-[#17171b]/82 text-white/82 backdrop-blur-md hover:bg-[#1e1e22]"
          >
            <PreviewIcon />
          </button>
          <button
            onClick={() => {
              const a = document.createElement("a");
              a.href = downloadSrc!;
              a.download = `image-${Date.now()}.${format}`;
              a.click();
            }}
            title="下载"
            className="grid h-9 w-9 place-items-center rounded-full border border-white/[0.10] bg-[#17171b]/82 text-white/82 backdrop-blur-md hover:bg-[#1e1e22]"
          >
            <DownloadIcon />
          </button>
        </div>
      )}
    </article>
  );
}

function PreviewIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 2h5v5M14 2l-5 5M7 14H2v-5M2 14l5-5" />
    </svg>
  );
}

function SparkleSmallIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <path d="M7 0 L8.1 5.9 L14 7 L8.1 8.1 L7 14 L5.9 8.1 L0 7 L5.9 5.9 Z" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 2l3 3-9 9H2v-3l9-9z" />
    </svg>
  );
}

function BrushIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 2l3 3-7 7-3 .5.5-3 6.5-7.5z" />
      <path d="M2 14h6" />
    </svg>
  );
}

function BrainIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1.5C6.5 1.5 5 2.5 5 4c0 1-.5 1.5-1 2-.7.7-1 1.5-1 2.5s.3 1.8 1 2.5c.5.5 1 1 1 2 0 1.5 1.5 2.5 3 2.5s3-1 3-2.5c0-1 .5-1.5 1-2 .7-.7 1-1.5 1-2.5s-.3-1.8-1-2.5c-.5-.5-1-1-1-2 0-1.5-1.5-2.5-3-2.5z" />
      <path d="M6 6.5h4M6 9.5h4" />
    </svg>
  );
}

/** 全屏图片预览遮罩：点背景或 ESC 关闭 */
function ImagePreviewModal({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] grid place-items-center bg-black/82 backdrop-blur-md"
    >
      <img
        src={src}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] max-w-[92vw] rounded-[12px] border border-white/[0.08] shadow-2xl"
        draggable={false}
      />
      <button
        onClick={onClose}
        title="关闭"
        className="absolute right-6 top-6 grid h-10 w-10 place-items-center rounded-full border border-white/[0.08] bg-[#17171b]/82 text-white/80 backdrop-blur-md hover:bg-[#1e1e22]"
      >
        ✕
      </button>
    </div>
  );
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.5 8L14.5 2 9.5 14l-2-5-6-1z" />
    </svg>
  );
}

/**
 * 结果画廊：单图大图展示 + 左侧缩略图列表；多图网格展示，点击进入大图预览模式
 */
function ResultGallery({
  images,
  format,
  onPreview,
  onCropper,
  onAiCutout,
}: {
  images: ApiImage[];
  format: string;
  onPreview?: (src: string) => void;
  onCropper?: (src: string) => void;
  onAiCutout?: (src: string) => void;
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);

  // 预热所有图的 safeImageSrc（大图区走 /api/images/proxy-image 同源代理，
  // 缩略图直连 CDN —— 不预热的话每次切大图都要等后端代理首次拉取，体感卡顿）
  useEffect(() => {
    const preloads: HTMLImageElement[] = [];
    for (const item of images) {
      const raw = imageToSrc(item, format);
      if (!raw) continue;
      const im = new Image();
      im.src = safeImageSrc(raw);
      preloads.push(im);
    }
    return () => {
      for (const im of preloads) im.src = "";
    };
  }, [images, format]);

  if (images.length === 1) {
    return (
      <div className="flex h-full flex-col gap-3">
        <div className="relative flex-1 overflow-hidden rounded-[20px] border border-white/[0.05] bg-[#111114]">
          <ResultImage
            img={images[0]}
            format={format}
            large
            onPreview={onPreview}
            onCropper={onCropper}
            onAiCutout={onAiCutout}
          />
        </div>
      </div>
    );
  }

  // 多图：选中索引的大图 + 下方缩略图行
  const selectedImg = images[selectedIdx];
  return (
    <div className="flex h-full flex-col gap-3">
      {/* 大图区 */}
      <div className="relative flex-1 overflow-hidden rounded-[20px] border border-white/[0.05] bg-[#111114]">
        <ResultImage
          img={selectedImg}
          format={format}
          large
          onPreview={onPreview}
          onCropper={onCropper}
          onAiCutout={onAiCutout}
        />
        {/* 左右切换 */}
        {images.length > 1 && (
          <>
            <button
              onClick={() => setSelectedIdx((i) => (i - 1 + images.length) % images.length)}
              className="absolute left-2 top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/[0.10] bg-[#17171b]/82 text-white/72 backdrop-blur-md hover:bg-[#1e1e22]"
            >
              ‹
            </button>
            <button
              onClick={() => setSelectedIdx((i) => (i + 1) % images.length)}
              className="absolute right-2 top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/[0.10] bg-[#17171b]/82 text-white/72 backdrop-blur-md hover:bg-[#1e1e22]"
            >
              ›
            </button>
            <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-[11px] text-white/82">
              {selectedIdx + 1} / {images.length}
            </div>
          </>
        )}
      </div>
      {/* 缩略图行 */}
      <div className="flex shrink-0 gap-2 overflow-x-auto pb-0.5 [scrollbar-color:rgba(255,255,255,0.16)_transparent] [scrollbar-width:thin]">
        {images.map((img, i) => {
          const src = imageToSrc(img, format);
          return (
            <button
              key={i}
              onClick={() => setSelectedIdx(i)}
              className={`shrink-0 overflow-hidden rounded-[12px] border-2 transition-all ${
                i === selectedIdx
                  ? "border-accent-foxo opacity-100"
                  : "border-transparent opacity-55 hover:opacity-80"
              }`}
              style={{ width: 64, height: 64 }}
            >
              {src ? (
                <img src={src} alt="" className="h-full w-full object-cover" draggable={false} />
              ) : (
                <div className="grid h-full w-full place-items-center bg-[#1e1e22] text-[10px] text-white/35">
                  —
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* gpt-image-2 比例 × 分辨率 → 实际 size 映射表
   每一项均满足：16 倍数 / 单边 ≤3840 / 总像素 ∈ [655360, 8294400] / 比例 ≤3:1 */
const SIZE_TABLE: Record<string, Record<string, string>> = {
  "1:1":  { "1K": "1024×1024", "2K": "2048×2048", "4K": "2880×2880" },
  "16:9": { "1K": "1792×1024", "2K": "2048×1152", "4K": "3840×2160" },
  "9:16": { "1K": "1024×1792", "2K": "1152×2048", "4K": "2160×3840" },
  "2:3":  { "1K": "1024×1536", "2K": "1536×2304", "4K": "2304×3456" },
  "3:2":  { "1K": "1536×1024", "2K": "2304×1536", "4K": "3456×2304" },
};

/* gpt-image-2 自定义尺寸校验：返回 null 表示通过，字符串为错误提示 */
function validateCustomSize(w: number, h: number): string | null {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return "宽高必须是正整数";
  }
  if (!Number.isInteger(w) || !Number.isInteger(h)) {
    return "宽高必须是整数";
  }
  if (w % 16 !== 0 || h % 16 !== 0) {
    return "宽高必须是 16 的倍数";
  }
  if (w > 3840 || h > 3840) {
    return "单边不能超过 3840";
  }
  const total = w * h;
  if (total < 655_360) {
    return "总像素需 ≥ 655,360";
  }
  if (total > 8_294_400) {
    return "总像素需 ≤ 8,294,400";
  }
  const ratio = Math.max(w, h) / Math.min(w, h);
  if (ratio > 3) {
    return "宽高比不能超过 3:1";
  }
  return null;
}

function rectToGlassShape(rect: DOMRect): GlassShape {
  return {
    centerX: rect.left + rect.width / 2,
    centerY: rect.top + rect.height / 2,
    width: rect.width,
    height: rect.height,
    radius: GENERATE_CARD_RADIUS,
  };
}

/* ---------- 顶部条（按参考图 1:1 复刻） ---------- */
function TopBarReplica({
  mode,
  onModeChange,
}: {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
}) {
  return (
    <header className="relative z-30 flex h-[76px] items-start px-3 pt-3">
      <nav className="flex items-center gap-1.5">
        <TopBarTab onClick={() => onModeChange(mode === "generate" ? "workflow" : "generate")}>
          切换模式
        </TopBarTab>
      </nav>
    </header>
  );

  return (
    <header className="relative z-30 flex h-14 items-center gap-3 px-6">
      {/* 左：螺旋 logo + Workflow/Edit/Help 胶囊 */}
      <Logo />
      <PillTab active>工作流</PillTab>
      <PillTab>编辑</PillTab>
      <PillTab>帮助</PillTab>

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

function TopBarTab({
  children,
  active = false,
  onClick,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-12 min-w-[110px] rounded-[10px] px-6 text-[13px] font-medium ${topBarSurface(active)}`}
    >
      {children}
    </button>
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
      <span>队列</span>
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
              提示词
            </span>
          </div>

          <button className="flex items-center gap-1.5 rounded-full bg-[#7CE38B] px-3 py-1.5 text-[12px] font-medium text-canvas hover:brightness-105">
            <SparkleIcon />
            生成
          </button>
        </div>

        <PromptSection
          label="正向"
          color={C.positive}
          currentText="A black bear with a pink snout, minimalist style, soft gradients, clear blue sky"
          placeholder="输入你想要的画面内容"
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
              负面
            </span>
          </div>

          <button className="flex items-center gap-1.5 rounded-full bg-[#FF7E87] px-3 py-1.5 text-[12px] font-medium text-canvas hover:brightness-105">
            <SparkleIcon />
            生成
          </button>
        </div>

        <PromptSection
          label="负面"
          color={C.negative}
          currentText="No text, unnecessary details, background objects, other animals or people."
          placeholder="输入你不想要的内容"
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
            图像生成器
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
              <PortLabelRow label="模型" color={C.model} side="left" />
              <PortLabelRow label="正向" color={C.positive} side="left" />
              <PortLabelRow label="负面" color={C.negative} side="left" />
            </div>
            <PortLabelRow label="图像" color={C.image} side="right" />
          </div>

          {/* 参数列表 */}
          <div className="mt-5 space-y-2.5">
            <ParamRow label="随机种子" value="12345" />
            <ParamRow label="控制模式" value="固定" />
            <ParamRow label="质量步数">
              <StepperControl value={30} />
            </ParamRow>
            <ParamRow label="提示词强度" value="8.0" />
            <ParamRow label="采样方法" value="dpm++ 2M" />
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
            预览图像
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
                最终结果
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
        添加节点
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
            模型
          </span>
        </div>

        {/* 灰色容器卡 —— flex-1 撑满父级剩余高度 */}
        <div
          className="flex flex-1 flex-col rounded-[20px] border border-white/[0.04] p-4"
          style={{ background: "#1e1e22" }}
        >
          <div className="ml-auto w-max space-y-1.5 text-right">
            <InsetPortRow label="模型" color={C.model} />
            <InsetPortRow label="正向" color={C.positive} />
            <InsetPortRow label="负面" color={C.negative} />
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
