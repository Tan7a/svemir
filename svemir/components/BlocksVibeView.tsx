"use client";

import { useMemo, useState } from "react";
import type { ChannelTag, Item } from "@/lib/types";
import BlockCard from "./BlockCard";
import VibeScale from "./VibeScale";

type VibeBlock = Item & { channels?: ChannelTag[] };

/** A block's vibe key: first category → source → kind (matches the old sort). */
function vibeKey(b: Item): string {
  return (b.categories?.[0] || b.source_name || b.kind || "misc").toLowerCase();
}

/**
 * The "Vibes" order, reimagined as an interactive scale. Instead of a one-shot
 * random shuffle (where you couldn't tell which vibe you were seeing), this
 * buckets blocks by vibe and lets you scrub the side scale through them — the
 * grid swaps to the selected vibe instantly, client-side.
 */
export default function BlocksVibeView({ blocks }: { blocks: VibeBlock[] }) {
  // Ordered vibe list: most common first, so the scale runs from your biggest
  // themes down to niche ones. byVibe maps each vibe → its blocks.
  const { vibes, byVibe } = useMemo(() => {
    const map = new Map<string, VibeBlock[]>();
    for (const b of blocks) {
      const k = vibeKey(b);
      const bucket = map.get(k) ?? map.set(k, []).get(k)!;
      bucket.push(b);
    }
    const ordered = [...map.keys()].sort(
      (a, b) => map.get(b)!.length - map.get(a)!.length || a.localeCompare(b)
    );
    return { vibes: ordered, byVibe: map };
  }, [blocks]);

  const [index, setIndex] = useState(0);
  const safeIndex = Math.min(index, Math.max(0, vibes.length - 1));
  const currentVibe = vibes[safeIndex];
  const shown = currentVibe ? byVibe.get(currentVibe) ?? [] : [];

  if (blocks.length === 0) {
    return (
      <div className="px-5 py-12 text-sm text-neutral-500">
        No blocks yet — add some from /admin.
      </div>
    );
  }

  return (
    <div className="px-3 pb-20 sm:px-8 md:pr-24">
      <VibeScale
        vibes={vibes}
        index={safeIndex}
        count={shown.length}
        onChange={setIndex}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 md:gap-5 xl:grid-cols-5">
        {shown.map((b) => (
          <BlockCard key={b.id} block={b} />
        ))}
      </div>
    </div>
  );
}
