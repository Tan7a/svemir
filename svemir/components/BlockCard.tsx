import Link from "next/link";
import Image from "next/image";
import type { ChannelTag, Item } from "@/lib/types";

type Props = {
  block: Item & { channels?: ChannelTag[] };
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

/**
 * Block card for the dense Blocks grid.
 *
 * Image-forward, gallery style: at rest the square is just the image, so the
 * grid reads as a wall of inspiration. On hover the image gently zooms inside
 * its clipped frame and a gradient caption fades up from the bottom with the
 * title + source — context on demand, never competing with the imagery.
 */
export default function BlockCard({ block }: Props) {
  const source = sourceLabel(block);
  const channels = block.channels ?? [];

  return (
    <Link
      href={`/block/${block.id}`}
      className="group relative block"
      // Soft client-side navigation triggers the @modal interceptor; a
      // shareable / refreshable full-page URL still works for direct nav.
    >
      <div className="relative aspect-square w-full overflow-hidden border border-neutral-800 bg-neutral-900 transition-colors duration-300 group-hover:border-neutral-600">
        {block.image_url ? (
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

        {/* Hover caption — title + source fade up over a gradient scrim. */}
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
      </div>

      {/* Topic tags — always visible below the thumbnail. */}
      {channels.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1 px-0.5">
          {channels.slice(0, 3).map((c) => (
            <span
              key={c.slug}
              className="rounded-full border border-neutral-800 bg-neutral-900 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-neutral-400"
            >
              {c.title}
            </span>
          ))}
          {channels.length > 3 && (
            <span className="px-1 py-0.5 text-[9px] text-neutral-500">
              +{channels.length - 3}
            </span>
          )}
        </div>
      )}
    </Link>
  );
}
