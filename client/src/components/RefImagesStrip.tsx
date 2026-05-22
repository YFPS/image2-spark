import { useRef } from "react";

type Item = { id: string; dataURL: string };

type Props = {
  items: Item[];
  onRemove: (id: string) => void;
  onAddFiles: (files: File[]) => void;
};

/**
 * 聊天输入框上方的参考图横向缩略图条。
 *  - 仅当 items.length > 0 时显示（外部条件渲染）
 *  - 每张右上角 × 删除
 *  - 最右一个 + 触发文件 picker，传给 onAddFiles
 *  - 与左侧参考图卡共享同一份 state，删一处另一处即同步
 */
export function RefImagesStrip({ items, onRemove, onAddFiles }: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="mb-2 grid grid-cols-5 gap-2">
      {items.map((it) => (
        <div
          key={it.id}
          className="group relative h-10 w-10 shrink-0 overflow-hidden rounded-[10px] border border-white/[0.06] bg-[#111114]"
        >
          <img
            src={it.dataURL}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
          />
          <button
            type="button"
            onClick={() => onRemove(it.id)}
            className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-black/85 text-[12px] leading-none text-white ring-1 ring-white/30 transition-colors hover:bg-black"
            title="移除"
            aria-label="移除参考图"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-dashed border-white/[0.10] text-[18px] text-white/45 hover:border-white/[0.20] hover:text-white/72"
        title="添加参考图"
        aria-label="添加参考图"
      >
        +
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onAddFiles(files);
          // 重置 value 让相同文件能再次触发 onChange
          e.target.value = "";
        }}
      />
    </div>
  );
}
