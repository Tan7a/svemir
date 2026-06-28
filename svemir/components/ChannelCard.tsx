import Link from "next/link";
import Image from "next/image";
import type { ChannelWithBlocks } from "@/lib/types";
import ChannelActions from "./ChannelActions";
import EditableTitle from "./EditableTitle";
import { renameChannel } from "@/app/admin/actions";

type Props = {
  channel: ChannelWithBlocks & { last_connected_at?: string | null };
};

const MAX_THUMBS = 8;

/**
 * Channel card for the home Channels view. Title + meta sit top-left, and a
 * full-width strip of real block thumbnails fills the space below (no empty
 * placeholder cells). The "…" actions menu appears in the top-right on hover.
 */
export default function ChannelCard({ channel }: Props) {
  const thumbs = channel.blocks.slice(0, MAX_THUMBS);
  const count = channel.block_count;

  // Most common categories across the channel's (sampled) blocks — a lightweight
  // "what's in here" summary for the info popup.
  const topicCounts = new Map<string, number>();
  for (const b of channel.blocks) {
    for (const c of b.categories ?? []) {
      topicCounts.set(c, (topicCounts.get(c) ?? 0) + 1);
    }
  }
  const topics = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([c]) => c);

  return (
    <div className="group relative flex flex-col rounded-2xl border border-neutral-800 transition-colors hover:border-white">
      {/* Top-left — title + meta. The after:inset-0 overlay makes the whole card
          a link to the channel (stretched-link). */}
      <Link
        href={`/channel/${channel.slug}`}
        className="flex flex-col items-start gap-1 px-6 pb-4 pt-6 text-left after:absolute after:inset-0 after:content-['']"
      >
        <EditableTitle
          value={channel.title}
          onRename={renameChannel.bind(null, channel.id)}
          as="span"
          className="relative z-10 cursor-text text-2xl font-light text-neutral-100"
          inputClassName="relative z-10 w-full max-w-[260px] border-b border-neutral-500 bg-transparent text-2xl font-light text-neutral-100 outline-none"
        />
        <span className="text-xs text-neutral-500">
          {count} block{count === 1 ? "" : "s"}
        </span>
      </Link>

      {/* Below — full-width strip of real thumbnails. pointer-events-none lets
          clicks on empty strip space fall through to the channel overlay; each
          thumbnail re-enables clicks and sits above the overlay (z-10). */}
      <div className="pointer-events-none flex gap-3 overflow-hidden px-6 pb-6">
        {thumbs.length === 0 ? (
          <div className="flex h-[240px] w-full items-center justify-center text-xs text-neutral-600">
            No blocks yet
          </div>
        ) : (
          thumbs.map((b) => (
            <Link
              key={b.id}
              href={`/block/${b.id}`}
              className="pointer-events-auto relative z-10 aspect-square h-[240px] w-[240px] shrink-0 overflow-hidden rounded-2xl bg-neutral-900"
            >
              {b.kind === "paper" ? (
                <div className="flex h-full w-full flex-col gap-1.5 p-3">
                  <span className="line-clamp-3 text-[11px] font-medium leading-snug text-neutral-100">
                    {b.title || "Untitled"}
                  </span>
                  {b.paper_year && (
                    <span className="text-[9px] text-neutral-500">{b.paper_year}</span>
                  )}
                  {b.description && (
                    <span className="line-clamp-4 text-[9px] leading-snug text-neutral-400">
                      {b.description}
                    </span>
                  )}
                </div>
              ) : b.image_url ? (
                <Image
                  src={b.image_url}
                  alt={b.title}
                  fill
                  sizes="(min-width: 768px) 280px, 50vw"
                  quality={100}
                  className="object-cover transition-opacity hover:opacity-90"
                />
              ) : b.kind === "text" && b.description ? (
                <div className="flex h-full w-full items-center justify-center p-2 text-[9px] leading-snug text-neutral-400">
                  <span className="line-clamp-5">{b.description}</span>
                </div>
              ) : (
                <div className="flex h-full w-full items-center justify-center text-neutral-700">
                  ○
                </div>
              )}
            </Link>
          ))
        )}
      </div>

      {/* Hover-revealed actions menu — z-20 keeps it above the card overlay */}
      <div className="pointer-events-none absolute right-3 top-3 z-20 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <div className="pointer-events-auto">
          <ChannelActions
            channelId={channel.id}
            channelTitle={channel.title}
            hasParent={channel.parent_id !== null}
            info={{
              description: channel.description,
              blockCount: count,
              createdAt: channel.created_at,
              lastUpdated: channel.last_connected_at ?? null,
              topics,
            }}
          />
        </div>
      </div>
    </div>
  );
}
