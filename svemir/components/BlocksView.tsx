"use client";

import { useCallback, useMemo, useState } from "react";
import type { ChannelTag, Item } from "@/lib/types";
import BlockCard from "./BlockCard";
import BlockSelectionBar from "./BlockSelectionBar";

type Block = Item & { channels?: ChannelTag[] };

type Props = {
  blocks: Block[];
};

/**
 * Dense grid of square BlockCards.
 *
 * ~5 columns on desktop, 3 on tablet, 2 on mobile. Generous (~40px) gutters
 * make it an inspiring scroll. Strips everything except thumbnail + title.
 *
 * Holds Pinterest-style multi-select state: each card shows a selection circle
 * on hover, and a floating action bar (add to channel / export / delete)
 * appears while any block is selected.
 */
export default function BlocksView({ blocks }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const selectedBlocks = useMemo(
    () => blocks.filter((b) => selectedIds.has(b.id)),
    [blocks, selectedIds]
  );

  if (blocks.length === 0) {
    return (
      <div className="px-8 py-12 text-sm text-neutral-500">
        No blocks yet — add some from /admin.
      </div>
    );
  }

  const selectionActive = selectedIds.size > 0;

  return (
    <div className="px-3 pb-20 sm:px-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 md:gap-5 xl:grid-cols-5">
        {blocks.map((b) => (
          <BlockCard
            key={b.id}
            block={b}
            selected={selectedIds.has(b.id)}
            selectionActive={selectionActive}
            onToggleSelect={toggleSelect}
          />
        ))}
      </div>

      {selectionActive && (
        <BlockSelectionBar selected={selectedBlocks} onClear={clearSelection} />
      )}
    </div>
  );
}
