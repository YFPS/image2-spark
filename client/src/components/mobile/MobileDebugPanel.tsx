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
