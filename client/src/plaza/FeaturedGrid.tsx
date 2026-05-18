import type { RefObject } from "react";
import type { Featured } from "./types";
import { FeaturedCard } from "./FeaturedCard";

// 旗舰 4 卡的 grid：桌面 4 列等宽（DESIGN.md v0.2 不再强调"第一张更宽"）；
// 窄屏退化为 2 列 / 1 列。
// cardRefs：可选 ref 数组，ModelPlaza 用它收集 4 张卡的 DOM 位置上报给全局 LiquidGlass。

type Props = {
  items: Featured[];
  onCardClick: (card: Featured) => void;
  cardRefs?: RefObject<HTMLButtonElement>[];
};

export function FeaturedGrid({ items, onCardClick, cardRefs }: Props) {
  return (
    <section className="grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-md:grid-cols-1">
      {items.map((card, i) => (
        <FeaturedCard
          key={card.id}
          ref={cardRefs?.[i]}
          card={card}
          onClick={() => onCardClick(card)}
        />
      ))}
    </section>
  );
}
