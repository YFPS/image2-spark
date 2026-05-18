// 一组 tick（pinned / 其余），无分组标签
import type { ConversationListItem } from "../api/conversations";
import { SessionCard } from "./SessionCard";

type Props = {
  items: ConversationListItem[];
  /** 全列表索引基准（让长短交替跨组连续） */
  indexOffset: number;
  expanded: boolean;
  currentId: number | null;
  onSelect: (id: number) => void;
  onRename: (id: number, title: string) => void;
  onTogglePin: (id: number) => void;
  onDelete: (id: number) => void;
};

export function SessionGroup(props: Props) {
  if (props.items.length === 0) return null;

  return (
    <div className="flex w-full flex-col items-stretch gap-0">
      {props.items.map((c, i) => (
        <SessionCard
          key={c.id}
          conv={c}
          index={props.indexOffset + i}
          expanded={props.expanded}
          selected={props.currentId === c.id}
          onSelect={() => props.onSelect(c.id)}
          onRename={(t) => props.onRename(c.id, t)}
          onTogglePin={() => props.onTogglePin(c.id)}
          onDelete={() => props.onDelete(c.id)}
        />
      ))}
    </div>
  );
}
