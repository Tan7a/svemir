import type { ChannelTag, Item } from "@/lib/types";
import BlockCard from "./BlockCard";

type Props = {
  blocks: (Item & { channels?: ChannelTag[] })[];
};

/**
 * Dense grid of square BlockCards.
 *
 * ~5 columns on desktop, 3 on tablet, 2 on mobile. Generous (~40px) gutters
 * make it an inspiring scroll. Strips everything except thumbnail + title —
 * the are.na pattern.
 */
export default function BlocksView({ blocks }: Props) {
  if (blocks.length === 0) {
    return (
      <div className="px-8 py-12 text-sm text-neutral-500">
        No blocks yet — add some from /admin.
      </div>
    );
  }

  return (
    <div className="px-3 pb-20 sm:px-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 md:gap-5 xl:grid-cols-5">
        {blocks.map((b) => (
          <BlockCard key={b.id} block={b} />
        ))}
      </div>
    </div>
  );
}
