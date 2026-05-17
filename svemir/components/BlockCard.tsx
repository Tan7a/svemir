import Link from "next/link";
import Image from "next/image";
import type { Item } from "@/lib/types";

type Props = {
  block: Item;
};

/**
 * Minimal block card for the dense Blocks grid.
 *
 * Per the IA: square thumbnail + truncated title. No tag pills, no source
 * letter badge — clicking is the only affordance. A small link-icon overlay
 * on `kind='link'` blocks (bottom-right of the thumb) signals the source is
 * external.
 */
export default function BlockCard({ block }: Props) {
  return (
    <Link
      href={`/block/${block.id}`}
      className="group flex flex-col gap-2 text-neutral-300 hover:text-neutral-100"
      // Soft client-side navigation triggers the @modal interceptor; a
      // shareable / refreshable full-page URL still works for direct nav.
    >
      <div className="relative aspect-square w-full overflow-hidden border border-neutral-800 bg-neutral-900">
        {block.image_url ? (
          <Image
            src={block.image_url}
            alt={block.title}
            fill
            sizes="(min-width: 1280px) 19vw, (min-width: 768px) 30vw, 48vw"
            className="object-cover transition-opacity group-hover:opacity-90"
          />
        ) : block.kind === "text" && block.description ? (
          <div className="flex h-full w-full items-center justify-center bg-neutral-900 p-3 text-[10px] leading-snug text-neutral-400">
            <span className="line-clamp-6">{block.description}</span>
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-neutral-700">
            ○
          </div>
        )}
        {block.kind === "link" && block.url && (
          <span
            aria-hidden
            className="absolute bottom-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-sm bg-black/60 text-[10px] text-neutral-200"
          >
            ↗
          </span>
        )}
      </div>
      <div className="line-clamp-2 px-0.5 text-xs leading-tight text-neutral-400 group-hover:text-neutral-200">
        {block.title || "Untitled"}
      </div>
    </Link>
  );
}
