import { useRef, useState, useCallback } from 'react';
import type { TouchEvent as ReactTouchEvent } from 'react';
import { useTouchEvents } from '../../hooks/useTouchEvents';
import type { TouchPoint } from '../../utils/touchUtils';

interface MobileCanvasProps {
  children: React.ReactNode;
  onNodeDrag: (id: string, delta: { x: number; y: number }) => void;
  onNodeDragStart?: (id: string) => void;
  onNodeDragEnd?: (id: string) => void;
  onCanvasTap: (point: { x: number; y: number }) => void;
  onCanvasDoubleTap: (point: { x: number; y: number }) => void;
  onCanvasLongPress: (point: { x: number; y: number }) => void;
  onPinchZoom: (scale: number) => void;
  onPortTouchStart?: (instanceId: string, portId: string, point: { x: number; y: number }) => void;
}

export function MobileCanvas({
  children,
  onNodeDrag,
  onNodeDragStart,
  onNodeDragEnd,
  onCanvasTap,
  onCanvasDoubleTap,
  onCanvasLongPress,
  onPinchZoom,
  onPortTouchStart,
}: MobileCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    nodeId: string;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const findNodeElement = useCallback((target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof HTMLElement)) return null;
    return target.closest('[data-node-instance]') as HTMLElement | null;
  }, []);

  const findPortElement = useCallback((target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof HTMLElement)) return null;
    return target.closest('[data-port-handle]') as HTMLElement | null;
  }, []);

  const handleTouchStart = useCallback((e: ReactTouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    const target = touch.target;

    const portEl = findPortElement(target);
    if (portEl && onPortTouchStart) {
      const instanceId = portEl.dataset.portInstance!;
      const portId = portEl.dataset.portId!;
      onPortTouchStart(instanceId, portId, { x: touch.clientX, y: touch.clientY });
      return;
    }

    const nodeEl = findNodeElement(target);
    if (nodeEl) {
      const nodeId = nodeEl.dataset.nodeInstance!;
      dragStateRef.current = {
        nodeId,
        startX: touch.clientX,
        startY: touch.clientY,
        lastX: touch.clientX,
        lastY: touch.clientY,
      };
      setIsDragging(true);
      onNodeDragStart?.(nodeId);
    }
  }, [findNodeElement, findPortElement, onNodeDragStart, onPortTouchStart]);

  const handleTouchMove = useCallback((e: ReactTouchEvent<HTMLDivElement>) => {
    if (!dragStateRef.current) return;
    e.preventDefault();

    const touch = e.touches[0];
    const state = dragStateRef.current;
    const deltaX = touch.clientX - state.lastX;
    const deltaY = touch.clientY - state.lastY;

    onNodeDrag(state.nodeId, { x: deltaX, y: deltaY });

    state.lastX = touch.clientX;
    state.lastY = touch.clientY;
  }, [onNodeDrag]);

  const handleTouchEnd = useCallback(() => {
    if (dragStateRef.current) {
      onNodeDragEnd?.(dragStateRef.current.nodeId);
      dragStateRef.current = null;
      setIsDragging(false);
    }
  }, [onNodeDragEnd]);

  const handleTap = useCallback((point: TouchPoint) => {
    if (isDragging) return;
    const element = document.elementFromPoint(point.x, point.y);
    const nodeElement = findNodeElement(element);

    if (!nodeElement) {
      onCanvasTap({ x: point.x, y: point.y });
    }
  }, [onCanvasTap, findNodeElement, isDragging]);

  const handleDoubleTap = useCallback((point: TouchPoint) => {
    onCanvasDoubleTap({ x: point.x, y: point.y });
  }, [onCanvasDoubleTap]);

  const handleLongPress = useCallback((point: TouchPoint) => {
    if (isDragging) return;
    onCanvasLongPress({ x: point.x, y: point.y });
  }, [onCanvasLongPress, isDragging]);

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
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {children}
    </div>
  );
}
