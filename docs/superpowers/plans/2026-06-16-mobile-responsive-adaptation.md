# 移动端响应式适配实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 image2 节点画布编辑器完整适配移动端，提供可用的触摸交互体验

**架构:** 采用渐进式增强策略：首先确保所有页面在移动端可访问且布局合理，然后为节点画布编辑器添加触摸事件支持，最后优化移动端专属交互体验。使用 Tailwind CSS 响应式工具类 + 自定义触摸事件处理。

**Tech Stack:** React 18, TypeScript, Tailwind CSS, WebGL (液态玻璃效果), 触摸事件 API

---

## 文件结构

### 新增文件
- `client/src/hooks/useMediaQuery.ts` - 响应式断点检测 hook
- `client/src/hooks/useTouchEvents.ts` - 触摸事件处理 hook
- `client/src/components/mobile/MobileCanvas.tsx` - 移动端画布组件
- `client/src/components/mobile/MobileNodePanel.tsx` - 移动端节点面板
- `client/src/components/mobile/MobileToolbar.tsx` - 移动端工具栏
- `client/src/utils/touchUtils.ts` - 触摸事件工具函数

### 修改文件
- `client/src/App.tsx` - 添加响应式布局逻辑，集成移动端组件
- `client/src/auth/AuthOverlay.tsx` - 优化移动端登录体验
- `client/src/index.css` - 添加移动端专属样式
- `client/tailwind.config.js` - 添加移动端断点配置
- `client/src/components/RecentWorksCard.tsx` - 适配移动端卡片布局
- `client/src/pages/GalleryPage.tsx` - 适配移动端画廊布局
- `client/src/pages/LogsPage.tsx` - 适配移动端日志布局

---

## 任务分解

### Task 1: 建立响应式基础设施

**Files:**
- Create: `client/src/hooks/useMediaQuery.ts`
- Modify: `client/tailwind.config.js`
- Modify: `client/src/index.css`

- [ ] **Step 1: 创建 useMediaQuery hook**

```typescript
// client/src/hooks/useMediaQuery.ts
import { useState, useEffect } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    if (media.matches !== matches) {
      setMatches(media.matches);
    }
    
    const listener = (e: MediaQueryListEvent) => setMatches(e.matches);
    media.addEventListener('change', listener);
    
    return () => media.removeEventListener('change', listener);
  }, [query, matches]);

  return matches;
}

// 预定义断点
export const useIsMobile = () => useMediaQuery('(max-width: 768px)');
export const useIsTablet = () => useMediaQuery('(max-width: 1024px)');
export const useIsDesktop = () => useMediaQuery('(min-width: 1025px)');
```

- [ ] **Step 2: 更新 Tailwind 配置添加移动端断点**

```javascript
// client/tailwind.config.js
export default {
  // ... 现有配置
  theme: {
    extend: {
      // ... 现有扩展
      screens: {
        'xs': '480px',
        'sm': '640px',
        'md': '768px',
        'lg': '1024px',
        'xl': '1280px',
        '2xl': '1536px',
      },
    },
  },
  // ... 其他配置
};
```

- [ ] **Step 3: 添加移动端基础样式**

```css
/* client/src/index.css */
@layer base {
  /* 移动端触摸优化 */
  @media (max-width: 768px) {
    body {
      -webkit-tap-highlight-color: transparent;
      -webkit-touch-callout: none;
      -webkit-user-select: none;
      user-select: none;
    }
    
    /* 禁用双击缩放 */
    * {
      touch-action: manipulation;
    }
    
    /* 允许特定元素的选择 */
    input, textarea, [contenteditable] {
      -webkit-user-select: text;
      user-select: text;
    }
  }
  
  /* 移动端安全区域 */
  @supports (padding: max(0px)) {
    .safe-area-bottom {
      padding-bottom: max(12px, env(safe-area-inset-bottom));
    }
    .safe-area-top {
      padding-top: max(12px, env(safe-area-inset-top));
    }
  }
}
```

- [ ] **Step 4: 验证响应式基础设施**

在浏览器开发者工具中测试不同屏幕尺寸，确保：
1. useMediaQuery hook 正确响应屏幕变化
2. Tailwind 断点类正常工作
3. 移动端样式正确应用

- [ ] **Step 5: 提交响应式基础设施**

```bash
git add client/src/hooks/useMediaQuery.ts client/tailwind.config.js client/src/index.css
git commit -m "feat: 建立移动端响应式基础设施"
```

### Task 2: 优化登录页面移动端体验

**Files:**
- Modify: `client/src/auth/AuthOverlay.tsx`

- [ ] **Step 1: 分析当前登录页面布局**

当前登录页面使用 `md:` 前缀进行响应式设计，但需要进一步优化移动端体验。

- [ ] **Step 2: 优化移动端布局**

```tsx
// client/src/auth/AuthOverlay.tsx
// 修改 main 元素的类名
<main className="relative z-10 flex min-h-screen items-center justify-center overflow-y-auto p-4 md:overflow-hidden md:p-8">
  <section className="relative grid w-full max-w-[1000px] overflow-hidden rounded-[36px] shadow-[0_32px_90px_rgba(0,0,0,0.55)] md:h-[700px] md:grid-cols-2">
    {/* 移动端：图片在上方，表单在下方 */}
    <div className="relative z-20 min-h-[360px] overflow-hidden rounded-t-[36px] md:min-h-0 md:rounded-l-[36px] md:rounded-r-none">
      {/* 图片内容 */}
    </div>
    
    <section
      ref={glassPanelRef}
      className="relative z-10 flex min-h-[520px] items-center justify-center rounded-b-[36px] border border-white/[0.08] p-6 md:min-h-0 md:rounded-l-none md:rounded-r-[36px] md:border-l-0 md:p-10"
      // ... 其他属性
    >
      {/* 表单内容 */}
    </section>
  </section>
</main>
```

- [ ] **Step 3: 添加移动端专属交互优化**

```tsx
// 添加移动端触摸反馈
<button
  type="submit"
  disabled={busy}
  className="mt-5 h-[50px] w-full rounded-full text-[14px] font-semibold tracking-normal text-[#0D0D0D] transition-all hover:brightness-105 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 md:hover:brightness-105"
  style={{
    background: ACCENT,
    boxShadow: "0 0 24px rgba(240,254,45,0.35)",
  }}
>
  {/* 按钮内容 */}
</button>
```

- [ ] **Step 4: 测试移动端登录流程**

在移动设备或浏览器开发者工具中测试：
1. 页面布局是否合理
2. 表单输入是否正常
3. 触摸交互是否流畅
4. 键盘弹出时页面是否正确调整

- [ ] **Step 5: 提交登录页面优化**

```bash
git add client/src/auth/AuthOverlay.tsx
git commit -m "feat: 优化登录页面移动端体验"
```

### Task 3: 创建触摸事件处理系统

**Files:**
- Create: `client/src/hooks/useTouchEvents.ts`
- Create: `client/src/utils/touchUtils.ts`

- [ ] **Step 1: 创建触摸工具函数**

```typescript
// client/src/utils/touchUtils.ts
export interface TouchPoint {
  x: number;
  y: number;
  timestamp: number;
}

export interface SwipeGesture {
  direction: 'left' | 'right' | 'up' | 'down';
  distance: number;
  velocity: number;
}

export function getTouchPoint(touch: Touch): TouchPoint {
  return {
    x: touch.clientX,
    y: touch.clientY,
    timestamp: Date.now(),
  };
}

export function calculateSwipe(start: TouchPoint, end: TouchPoint): SwipeGesture | null {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  const timeDelta = end.timestamp - start.timestamp;
  
  // 最小滑动距离和时间阈值
  if (distance < 50 || timeDelta < 50 || timeDelta > 1000) {
    return null;
  }
  
  const velocity = distance / timeDelta;
  
  // 确定主要方向
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    return {
      direction: deltaX > 0 ? 'right' : 'left',
      distance,
      velocity,
    };
  } else {
    return {
      direction: deltaY > 0 ? 'down' : 'up',
      distance,
      velocity,
    };
  }
}

export function isPinchGesture(touches: TouchList): boolean {
  return touches.length === 2;
}

export function calculatePinchDistance(touches: TouchList): number {
  if (touches.length < 2) return 0;
  
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  
  return Math.sqrt(dx * dx + dy * dy);
}
```

- [ ] **Step 2: 创建触摸事件 hook**

```typescript
// client/src/hooks/useTouchEvents.ts
import { useRef, useCallback, useEffect } from 'react';
import { TouchPoint, getTouchPoint, calculateSwipe, SwipeGesture } from '../utils/touchUtils';

interface TouchEventHandler {
  onSwipe?: (gesture: SwipeGesture) => void;
  onTap?: (point: TouchPoint) => void;
  onDoubleTap?: (point: TouchPoint) => void;
  onLongPress?: (point: TouchPoint) => void;
  onPinch?: (scale: number) => void;
}

export function useTouchEvents(
  elementRef: React.RefObject<HTMLElement | null>,
  handlers: TouchEventHandler
) {
  const touchStartRef = useRef<TouchPoint | null>(null);
  const lastTapRef = useRef<number>(0);
  const longPressTimerRef = useRef<number | null>(null);
  const initialPinchDistanceRef = useRef<number>(0);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    const point = getTouchPoint(touch);
    touchStartRef.current = point;
    
    // 长按检测
    longPressTimerRef.current = window.setTimeout(() => {
      handlers.onLongPress?.(point);
    }, 500);
    
    // 双指缩放检测
    if (e.touches.length === 2 && handlers.onPinch) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      initialPinchDistanceRef.current = Math.sqrt(dx * dx + dy * dy);
    }
  }, [handlers]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    // 清除长按定时器
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    
    // 双指缩放处理
    if (e.touches.length === 2 && handlers.onPinch && initialPinchDistanceRef.current > 0) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const currentDistance = Math.sqrt(dx * dx + dy * dy);
      const scale = currentDistance / initialPinchDistanceRef.current;
      handlers.onPinch(scale);
    }
  }, [handlers]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    // 清除长按定时器
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    
    if (!touchStartRef.current) return;
    
    const touch = e.changedTouches[0];
    const endPoint = getTouchPoint(touch);
    const startTime = touchStartRef.current.timestamp;
    const endTime = endPoint.timestamp;
    const duration = endTime - startTime;
    
    // 滑动检测
    const swipe = calculateSwipe(touchStartRef.current, endPoint);
    if (swipe && handlers.onSwipe) {
      handlers.onSwipe(swipe);
      touchStartRef.current = null;
      return;
    }
    
    // 点击检测（短按且移动距离小）
    const dx = endPoint.x - touchStartRef.current.x;
    const dy = endPoint.y - touchStartRef.current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (duration < 300 && distance < 10) {
      const now = Date.now();
      const timeSinceLastTap = now - lastTapRef.current;
      
      // 双击检测
      if (timeSinceLastTap < 300 && handlers.onDoubleTap) {
        handlers.onDoubleTap(endPoint);
        lastTapRef.current = 0;
      } else {
        // 单击
        handlers.onTap?.(endPoint);
        lastTapRef.current = now;
      }
    }
    
    touchStartRef.current = null;
  }, [handlers]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchmove', handleTouchMove, { passive: true });
    element.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [elementRef, handleTouchStart, handleTouchMove, handleTouchEnd]);
}
```

- [ ] **Step 3: 测试触摸事件处理**

创建简单的测试页面验证：
1. 单击、双击、长按事件
2. 滑动手势识别
3. 双指缩放功能

- [ ] **Step 4: 提交触摸事件系统**

```bash
git add client/src/hooks/useTouchEvents.ts client/src/utils/touchUtils.ts
git commit -m "feat: 添加触摸事件处理系统"
```

### Task 4: 重构节点画布支持触摸交互

**Files:**
- Modify: `client/src/App.tsx`
- Create: `client/src/components/mobile/MobileCanvas.tsx`

- [ ] **Step 1: 分析当前画布交互逻辑**

当前画布使用鼠标事件：
- `startDrag` - 节点拖拽
- `startEdge` - 连线绘制
- `onCanvasContextMenu` - 右键菜单

需要转换为同时支持鼠标和触摸事件。

- [ ] **Step 2: 创建移动端画布组件**

```tsx
// client/src/components/mobile/MobileCanvas.tsx
import { useRef, useState, useCallback } from 'react';
import { useTouchEvents } from '../../hooks/useTouchEvents';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { TouchPoint } from '../../utils/touchUtils';

interface MobileCanvasProps {
  children: React.ReactNode;
  onNodeDrag: (id: string, delta: { x: number; y: number }) => void;
  onCanvasTap: (point: { x: number; y: number }) => void;
  onCanvasDoubleTap: (point: { x: number; y: number }) => void;
  onCanvasLongPress: (point: { x: number; y: number }) => void;
  onPinchZoom: (scale: number) => void;
}

export function MobileCanvas({
  children,
  onNodeDrag,
  onCanvasTap,
  onCanvasDoubleTap,
  onCanvasLongPress,
  onPinchZoom,
}: MobileCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleTap = useCallback((point: TouchPoint) => {
    // 检查是否点击在节点上
    const element = document.elementFromPoint(point.x, point.y);
    const nodeElement = element?.closest('[data-node-instance]');
    
    if (!nodeElement) {
      onCanvasTap({ x: point.x, y: point.y });
    }
  }, [onCanvasTap]);

  const handleDoubleTap = useCallback((point: TouchPoint) => {
    onCanvasDoubleTap({ x: point.x, y: point.y });
  }, [onCanvasDoubleTap]);

  const handleLongPress = useCallback((point: TouchPoint) => {
    onCanvasLongPress({ x: point.x, y: point.y });
  }, [onCanvasLongPress]);

  const handlePinch = useCallback((scale: number) => {
    onPinchZoom(scale);
  }, [onPinchZoom]);

  useTouchEvents(canvasRef, {
    onTap: handleTap,
    onDoubleTap: handleDoubleTap,
    onLongPress: handleLongPress,
    onPinch: handlePinch,
  });

  return (
    <div
      ref={canvasRef}
      className="relative h-full w-full touch-none"
      style={{ touchAction: 'none' }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 3: 修改 App.tsx 集成移动端画布**

```tsx
// client/src/App.tsx
import { MobileCanvas } from './components/mobile/MobileCanvas';
import { useIsMobile } from './hooks/useMediaQuery';

export default function App() {
  const isMobile = useIsMobile();
  // ... 其他状态

  const handleCanvasTap = useCallback((point: { x: number; y: number }) => {
    // 移动端点击空白处取消选择
    setSelectedId(null);
    setContextMenu(null);
  }, []);

  const handleCanvasLongPress = useCallback((point: { x: number; y: number }) => {
    // 移动端长按显示添加节点菜单
    setContextMenu({
      screenX: point.x,
      screenY: point.y,
      canvasX: point.x,
      canvasY: point.y - TOPBAR_H,
    });
  }, []);

  const handlePinchZoom = useCallback((scale: number) => {
    // 实现缩放逻辑
    console.log('Pinch zoom:', scale);
  }, []);

  return (
    <div className="relative h-screen overflow-hidden">
      {/* WebGL 液态玻璃层 */}
      <LiquidGlass shapes={glassShapes} params={glassParams} />
      
      {/* 移动端使用 MobileCanvas 包装 */}
      {isMobile ? (
        <MobileCanvas
          onNodeDrag={handleNodeDrag}
          onCanvasTap={handleCanvasTap}
          onCanvasDoubleTap={handleCanvasDoubleTap}
          onCanvasLongPress={handleCanvasLongPress}
          onPinchZoom={handlePinchZoom}
        >
          {/* 原有画布内容 */}
        </MobileCanvas>
      ) : (
        /* 桌面端原有画布内容 */
      )}
    </div>
  );
}
```

- [ ] **Step 4: 测试移动端画布交互**

在移动设备上测试：
1. 节点拖拽是否流畅
2. 长按菜单是否正常显示
3. 双指缩放是否工作
4. 点击空白处是否取消选择

- [ ] **Step 5: 提交移动端画布重构**

```bash
git add client/src/App.tsx client/src/components/mobile/MobileCanvas.tsx
git commit -m "feat: 重构节点画布支持移动端触摸交互"
```

### Task 5: 创建移动端节点面板

**Files:**
- Create: `client/src/components/mobile/MobileNodePanel.tsx`

- [ ] **Step 1: 设计移动端节点面板**

移动端屏幕空间有限，需要将节点属性面板改为底部抽屉式设计。

- [ ] **Step 2: 实现移动端节点面板**

```tsx
// client/src/components/mobile/MobileNodePanel.tsx
import { useState, useEffect } from 'react';
import { useIsMobile } from '../../hooks/useMediaQuery';

interface MobileNodePanelProps {
  nodeId: string | null;
  nodeType: string;
  children: React.ReactNode;
  onClose: () => void;
}

export function MobileNodePanel({
  nodeId,
  nodeType,
  children,
  onClose,
}: MobileNodePanelProps) {
  const isMobile = useIsMobile();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (nodeId) {
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  }, [nodeId]);

  if (!isMobile || !nodeId) return null;

  return (
    <>
      {/* 遮罩层 */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={() => {
            setIsOpen(false);
            onClose();
          }}
        />
      )}
      
      {/* 底部抽屉 */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 transform rounded-t-[20px] bg-[#1C1C20] transition-transform duration-300 ${
          isOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{
          maxHeight: '70vh',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.5)',
        }}
      >
        {/* 拖拽指示器 */}
        <div className="flex justify-center p-3">
          <div className="h-1 w-10 rounded-full bg-white/20" />
        </div>
        
        {/* 面板标题 */}
        <div className="px-4 pb-3">
          <h3 className="text-[16px] font-medium text-white">
            {nodeType === 'model' && '模型设置'}
            {nodeType === 'prompt' && '提示词编辑'}
            {nodeType === 'negativePrompt' && '负面提示词'}
            {nodeType === 'imageGen' && '图像生成器'}
            {nodeType === 'preview' && '预览图像'}
          </h3>
        </div>
        
        {/* 面板内容 */}
        <div className="overflow-y-auto px-4 pb-8" style={{ maxHeight: 'calc(70vh - 60px)' }}>
          {children}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 3: 集成移动端节点面板到 App.tsx**

```tsx
// client/src/App.tsx
import { MobileNodePanel } from './components/mobile/MobileNodePanel';

export default function App() {
  // ... 其他状态和逻辑

  const selectedNode = selectedId ? instances.find(i => i.id === selectedId) : null;

  return (
    <div className="relative h-screen overflow-hidden">
      {/* 其他内容 */}
      
      {/* 移动端节点面板 */}
      <MobileNodePanel
        nodeId={selectedId}
        nodeType={selectedNode?.type || ''}
        onClose={() => setSelectedId(null)}
      >
        {/* 根据节点类型渲染不同的面板内容 */}
        {selectedNode?.type === 'model' && <ModelNodeContent />}
        {selectedNode?.type === 'prompt' && <PromptNodeContent />}
        {/* 其他节点类型 */}
      </MobileNodePanel>
    </div>
  );
}
```

- [ ] **Step 4: 测试移动端节点面板**

在移动设备上测试：
1. 点击节点是否显示底部面板
2. 面板滑动是否流畅
3. 点击遮罩是否关闭面板
4. 面板内容是否可操作

- [ ] **Step 5: 提交移动端节点面板**

```bash
git add client/src/components/mobile/MobileNodePanel.tsx client/src/App.tsx
git commit -m "feat: 添加移动端节点属性面板"
```

### Task 6: 优化其他页面移动端布局

**Files:**
- Modify: `client/src/components/RecentWorksCard.tsx`
- Modify: `client/src/pages/GalleryPage.tsx`
- Modify: `client/src/pages/LogsPage.tsx`

- [ ] **Step 1: 优化 RecentWorksCard 移动端布局**

```tsx
// client/src/components/RecentWorksCard.tsx
export function RecentWorksCard() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {/* 卡片内容 */}
    </div>
  );
}
```

- [ ] **Step 2: 优化 GalleryPage 移动端布局**

```tsx
// client/src/pages/GalleryPage.tsx
export function GalleryPage() {
  return (
    <div className="container mx-auto px-4 py-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {/* 画廊内容 */}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 优化 LogsPage 移动端布局**

```tsx
// client/src/pages/LogsPage.tsx
export function LogsPage() {
  return (
    <div className="container mx-auto px-4 py-6">
      <div className="space-y-3">
        {/* 日志内容 */}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 测试各页面移动端显示**

在移动设备上测试所有页面：
1. 布局是否合理
2. 内容是否完整显示
3. 滚动是否流畅
4. 交互是否正常

- [ ] **Step 5: 提交页面布局优化**

```bash
git add client/src/components/RecentWorksCard.tsx client/src/pages/GalleryPage.tsx client/src/pages/LogsPage.tsx
git commit -m "feat: 优化各页面移动端响应式布局"
```

### Task 7: 移动端性能优化

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/LiquidGlass.tsx`

- [ ] **Step 1: 优化 WebGL 液态玻璃效果性能**

移动端 GPU 性能有限，需要优化 WebGL 渲染。

```tsx
// client/src/LiquidGlass.tsx
export function LiquidGlass({ shapes, params }: LiquidGlassProps) {
  const isMobile = useIsMobile();
  
  // 移动端降低渲染质量
  const optimizedParams = isMobile ? {
    ...params,
    blurQuality: 'low',
    reflectionIntensity: 0.5,
    refractionIntensity: 0.7,
  } : params;
  
  // ... 渲染逻辑
}
```

- [ ] **Step 2: 实现虚拟滚动优化长列表**

对于画廊和日志页面，实现虚拟滚动优化性能。

```tsx
// client/src/components/VirtualList.tsx
import { useVirtualizer } from '@tanstack/react-virtual';

export function VirtualList<T>({
  items,
  renderItem,
  estimateSize,
}: {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  estimateSize: (index: number) => number;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
  });
  
  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualItem.size}px`,
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            {renderItem(items[virtualItem.index], virtualItem.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 添加图片懒加载和渐进式加载**

```tsx
// client/src/components/ProgressiveImage.tsx
export function ProgressiveImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState(false);
  
  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* 低质量占位符 */}
      {!isLoaded && !error && (
        <div className="absolute inset-0 animate-pulse bg-white/5" />
      )}
      
      {/* 实际图片 */}
      <img
        src={src}
        alt={alt}
        className={`transition-opacity duration-300 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
        onLoad={() => setIsLoaded(true)}
        onError={() => setError(true)}
        loading="lazy"
      />
      
      {/* 错误状态 */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/5">
          <span className="text-white/30">加载失败</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 测试移动端性能**

在真实移动设备上测试：
1. 页面加载速度
2. 滚动流畅度
3. 动画帧率
4. 内存使用情况

- [ ] **Step 5: 提交性能优化**

```bash
git add client/src/App.tsx client/src/LiquidGlass.tsx client/src/components/VirtualList.tsx client/src/components/ProgressiveImage.tsx
git commit -m "feat: 移动端性能优化 - WebGL降级、虚拟滚动、图片懒加载"
```

### Task 8: 移动端测试与调试

**Files:**
- Create: `client/src/components/mobile/MobileDebugPanel.tsx`

- [ ] **Step 1: 创建移动端调试面板**

```tsx
// client/src/components/mobile/MobileDebugPanel.tsx
import { useState, useEffect } from 'react';

export function MobileDebugPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [info, setInfo] = useState({
    screenWidth: window.innerWidth,
    screenHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    userAgent: navigator.userAgent,
    touchSupport: 'ontouchstart' in window,
  });

  useEffect(() => {
    const handleResize = () => {
      setInfo(prev => ({
        ...prev,
        screenWidth: window.innerWidth,
        screenHeight: window.innerHeight,
      }));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 z-50 h-10 w-10 rounded-full bg-black/50 text-white"
      >
        D
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-black/80 p-4 text-white">
      <div className="mb-2 flex justify-between">
        <span className="font-medium">调试信息</span>
        <button onClick={() => setIsOpen(false)}>×</button>
      </div>
      <div className="space-y-1 text-xs">
        <div>屏幕: {info.screenWidth} × {info.screenHeight}</div>
        <div>像素比: {info.devicePixelRatio}</div>
        <div>触摸支持: {info.touchSupport ? '是' : '否'}</div>
        <div>用户代理: {info.userAgent.substring(0, 50)}...</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 集成调试面板到 App.tsx**

```tsx
// client/src/App.tsx
import { MobileDebugPanel } from './components/mobile/MobileDebugPanel';

export default function App() {
  return (
    <div className="relative h-screen overflow-hidden">
      {/* 其他内容 */}
      
      {/* 移动端调试面板 - 仅在开发环境显示 */}
      {process.env.NODE_ENV === 'development' && <MobileDebugPanel />}
    </div>
  );
}
```

- [ ] **Step 3: 进行全面移动端测试**

测试清单：
1. 不同设备尺寸（手机、平板）
2. 不同操作系统（iOS、Android）
3. 不同浏览器（Safari、Chrome、Firefox）
4. 不同网络条件（WiFi、4G、慢速网络）
5. 不同交互模式（触摸、键盘、辅助功能）

- [ ] **Step 4: 修复发现的问题**

根据测试结果修复问题：
1. 布局问题
2. 交互问题
3. 性能问题
4. 兼容性问题

- [ ] **Step 5: 提交测试与调试工具**

```bash
git add client/src/components/mobile/MobileDebugPanel.tsx client/src/App.tsx
git commit -m "feat: 添加移动端调试工具与测试优化"
```

---

## 自检清单

### 规范覆盖度检查
- [ ] 登录页面移动端适配
- [ ] 节点画布触摸交互
- [ ] 响应式布局系统
- [ ] 触摸手势支持
- [ ] 移动端性能优化
- [ ] 调试与测试工具

### 占位符检查
- [ ] 所有代码块完整可执行
- [ ] 无 "TODO"、"TBD" 等占位符
- [ ] 所有文件路径准确
- [ ] 所有命令可直接运行

### 类型一致性检查
- [ ] 接口定义前后一致
- [ ] 函数签名匹配
- [ ] 属性名称统一
- [ ] 类型导入正确

---

## 执行选项

**计划完成并保存到 `docs/superpowers/plans/2026-06-16-mobile-responsive-adaptation.md`。两种执行方式：**

**1. Subagent-Driven（推荐）** - 每个任务分配独立子代理，任务间审查，快速迭代

**2. Inline Execution** - 在当前会话中执行任务，批量执行带检查点

**选择哪种方式？**