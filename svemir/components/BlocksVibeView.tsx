"use client";

import { useMemo, useState } from "react";
import type { CardItem, ChannelTag } from "@/lib/types";
import BlockCard from "./BlockCard";
import VibeScale from "./VibeScale";

type VibeBlock = CardItem & { channels?: ChannelTag[] };

/** One slider stop: a top concept and the on-screen blocks that mention it. */
export type VibeBucket = { term: string; slug: string; blockIds: string[] };

/**
 * The "Vibes" order: an interactive scale over the archive's top concepts.
 * The server passes one bucket per concept (see app/page.tsx); the bottom
 * VibeScale scrubs between them and the grid swaps instantly, client-side.
 * Blocks outside every top concept simply don't appear here - Vibes is a
 * browsing lens, the other orders remain the full inventory.
 */
export default function BlocksVibeView({
  blocks,
  vibes,
}: {
  blocks: VibeBlock[];
  vibes: VibeBucket[];
}) {
  const byId = useMemo(
    () => new Map(blocks.map((b) => [b.id, b])),
    [blocks]
  );

  const [index, setIndex] = useState(0);
  const safeIndex = Math.min(index, Math.max(0, vibes.length - 1));
  const current = vibes[safeIndex];
  const shown = current
    ? current.blockIds.flatMap((id) => byId.get(id) ?? [])
    : [];

  if (blocks.length === 0) {
    return (
      <div className="px-5 py-12 text-sm text-neutral-500">
        No blocks yet - add some from the + button.
      </div>
    );
  }

  if (vibes.length === 0) {
    return (
      <div className="px-5 py-12 text-sm text-neutral-500">
        No vibes yet - concepts appear after blocks have been extracted
        (Manage → Re-extract).
      </div>
    );
  }

  return (
    // Extra bottom padding so the last card row clears the floating scale.
    <div className="px-3 pb-40 sm:px-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 md:gap-5 xl:grid-cols-5">
        {shown.map((b) => (
          <BlockCard key={b.id} block={b} />
        ))}
      </div>
      <VibeScale
        vibes={vibes.map((v) => v.term)}
        index={safeIndex}
        count={shown.length}
        onChange={setIndex}
      />
    </div>
  );
}
