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
