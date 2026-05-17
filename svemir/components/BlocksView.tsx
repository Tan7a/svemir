import type { Item } from "@/lib/types";
import BlockCard from "./BlockCard";

type Props = {
  blocks: Item[];
};

/**
 * Dense grid of BlockCards.
 *
 * ~5 columns on desktop, 3 on tablet, 2 on mobile. Strips everything except
 * thumbnail + title — the are.na pattern.
 */
export default function BlocksView({ blocks }: Props) {
  if (blocks.length === 0) {
    return (
      <div className="px-5 py-12 text-sm text-neutral-500">
        No blocks yet — add some from /admin.
      </div>
    );
  }

  return (
    <div className="px-5 pb-16">
      <div className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
        {blocks.map((b) => (
          <BlockCard key={b.id} block={b} />
        ))}
      </div>
    </div>
  );
}
