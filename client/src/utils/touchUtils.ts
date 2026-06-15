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
