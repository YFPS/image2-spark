import type { Featured } from "./types";
import { FeaturedCard } from "./FeaturedCard";

// 旗舰 4 卡的 grid：桌面 1.42:1:1:1（第一张更宽）；窄屏退化为 2 列 / 1 列。

type Props = {
  items: Featured[];
  onCardClick: (card: Featured) => void;
};

export function FeaturedGrid({ items, onCardClick }: Props) {
  return (
    <section className="grid grid-cols-[1.42fr_1fr_1fr_1fr] gap-4 max-lg:grid-cols-2 max-md:grid-cols-1">
      {items.map((card) => (
        <FeaturedCard key={card.id} card={card} onClick={() => onCardClick(card)} />
      ))}
    </section>
  );
}
