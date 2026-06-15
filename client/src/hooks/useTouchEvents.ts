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
