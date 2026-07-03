"use client";

import Link from "next/link";
import Image from "next/image";
import type { ChannelTag, Item } from "@/lib/types";
import SelectionCircle from "./ui/SelectionCircle";

type Props = {
  block: Item & { channels?: ChannelTag[] };
  /** Whether this card is currently part of a multi-select. */
  selected?: boolean;
  /** True when a selection is in progress (≥1 card selected) - reveals every
   *  card's circle so the grid reads as selectable, Pinterest-style. */
  selectionActive?: boolean;
  /** Provided by the selectable grid; its presence turns the circle on. */
  onToggleSelect?: (id: string) => void;
};

/**
 * Source attribution for the hover caption: the saved source name, falling
 * back to the URL's hostname (matching BlockDetail's "Source" row). Stripped of
 * a leading "www." and returned null when there's nothing to show.
 */
function sourceLabel(block: Item): string | null {
  if (block.source_name) return block.source_name;
  if (block.url) {
    try {
      return new URL(block.url).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  }
  return null;
}

/** "First Author et al." from a paper's author list, or null when empty. */
function authorLine(block: Item): string | null {
  const authors = block.paper_authors ?? [];
  if (authors.length === 0) return null;
  const shown = authors.slice(0, 2).join(", ");
  return authors.length > 2 ? `${shown} et al.` : shown;
}

/**
 * Block card for the dense Blocks grid.
 *
 * Image-forward, gallery style: at rest the square is just the image, so the
 * grid reads as a wall of inspiration. On hover the image gently zooms inside
 * its clipped frame and a gradient caption fades up from the bottom with the
 * title + source - context on demand, never competing with the imagery.
 *
 * When the grid passes `onToggleSelect`, a Pinterest-style selection circle
 * appears top-left on hover (and stays visible for every card once a selection
 * is active). The circle is a sibling of the card link - never nested inside
 * the <a> - so clicking it toggles selection without navigating, while a click
 * on the card body still opens the block.
 */
export default function BlockCard({
  block,
  selected = false,
  selectionActive = false,
  onToggleSelect,
}: Props) {
  const source = sourceLabel(block);
  const channels = block.channels ?? [];
  const isPaper = block.kind === "paper";
  const authors = authorLine(block);
  const selectable = typeof onToggleSelect === "function";
  const circleAlwaysOn = selected || selectionActive;

  return (
    <div className="group relative">
      <Link
        href={`/block/${block.id}`}
        className="relative block"
        // Soft client-side navigation triggers the @modal interceptor; a
        // shareable / refreshable full-page URL still works for direct nav.
      >
        <div
          className={`relative aspect-square w-full overflow-hidden rounded-3xl border bg-neutral-900 transition-colors duration-300 ${
            selected
              ? "border-white ring-2 ring-white"
              : "border-neutral-800 group-hover:border-white"
          }`}
        >
          {isPaper ? (
            // Papers have no image: show the metadata at rest, document-style.
            // No "Paper" pill - the shared "Research Papers" channel tag below the
            // card carries that signal and keeps papers filterable.
            <div className="flex h-full w-full flex-col gap-2 p-4">
              <span className="line-clamp-3 text-sm font-medium leading-snug text-neutral-100">
                {block.title || "Untitled"}
              </span>
              {(authors || block.paper_year) && (
                <span className="line-clamp-1 text-[10px] text-neutral-500">
                  {[authors, block.paper_year].filter(Boolean).join(" · ")}
                </span>
              )}
              {block.description && (
                <span className="line-clamp-5 text-[11px] leading-snug text-neutral-400">
                  {block.description}
                </span>
              )}
            </div>
          ) : block.image_url ? (
            <Image
              src={block.image_url}
              alt={block.title}
              fill
              sizes="(min-width: 1280px) 18vw, (min-width: 768px) 24vw, 48vw"
              quality={100}
              className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
            />
          ) : block.kind === "text" && block.description ? (
            <div className="flex h-full w-full items-center justify-center bg-neutral-900 p-4 text-xs leading-snug text-neutral-400">
              <span className="line-clamp-6">{block.description}</span>
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center text-neutral-700">
              ○
            </div>
          )}

          {/* Hover caption - title + source fade up over a gradient scrim. Papers
              already show their title at rest, so the scrim is skipped for them. */}
          {!isPaper && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-3 pt-10 opacity-0 transition duration-300 ease-out group-hover:opacity-100">
              <span className="line-clamp-2 text-sm font-medium leading-snug text-white">
                {block.title || "Untitled"}
              </span>
              {source && (
                <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-white/65">
                  <span className="truncate">{source}</span>
                  {block.kind === "link" && <span aria-hidden>↗</span>}
                </span>
              )}
            </div>
          )}
        </div>
      </Link>

      {/* Topic tags - siblings of the card link (not nested inside it) so each
          tag navigates to its own channel. A nested <a> inside the block <a>
          is invalid HTML and would just re-open the block. */}
      {channels.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1 px-0.5">
          {channels.slice(0, 3).map((c) => (
            <Link
              key={c.slug}
              href={`/channel/${c.slug}`}
              className="rounded-full border border-neutral-800 bg-neutral-900 px-2 py-1 text-[9px] font-medium uppercase tracking-wide text-neutral-400 transition-colors hover:border-neutral-600 hover:text-neutral-100"
            >
              {c.title}
            </Link>
          ))}
          {channels.length > 3 && (
            <span className="px-1 py-0.5 text-[9px] text-neutral-500">
              +{channels.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Selection circle - sibling of the link (valid HTML), layered above it
          in the top-right corner. Clicking toggles selection without navigating. */}
      {selectable && (
        <SelectionCircle
          selected={selected}
          ariaLabel={selected ? "Deselect block" : "Select block"}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleSelect(block.id);
          }}
          className={`absolute right-2.5 top-2.5 z-20 ${
            circleAlwaysOn ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        />
      )}
    </div>
  );
}
