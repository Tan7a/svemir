import Link from "next/link";
import Image from "next/image";
import type { ChannelWithBlocks } from "@/lib/types";
import ChannelActions from "./ChannelActions";
import EditableTitle from "./EditableTitle";
import { renameChannel } from "@/app/admin/actions";

type Props = {
  channel: ChannelWithBlocks;
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  const yr = Math.floor(mo / 12);
  return `${yr} year${yr === 1 ? "" : "s"} ago`;
}

const MAX_THUMBS = 8;

/**
 * Wide horizontal channel card in the home Channels view, matching the are.na
 * pattern. Left half: centred title + meta. Right half: a horizontal strip of
 * real block thumbnails (no empty placeholder cells). The "…" actions menu
 * appears in the top-right on hover.
 */
export default function ChannelCard({ channel }: Props) {
  const thumbs = channel.blocks.slice(0, MAX_THUMBS);
  const count = channel.block_count;

  return (
    <div className="group relative grid grid-cols-1 border border-neutral-800 transition-colors hover:border-white md:grid-cols-[320px_1fr]">
      {/* Left — title + meta in a fixed-width column so every channel's thumbnail
          strip lines up on the same vertical line. The after:inset-0 overlay
          makes the whole card a link to the channel (stretched-link). */}
      <Link
        href={`/channel/${channel.slug}`}
        className="flex flex-col items-start justify-center gap-1.5 pl-[60px] pr-6 py-16 text-left after:absolute after:inset-0 after:content-['']"
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
        <span className="text-xs text-neutral-500">
          {relativeTime(channel.created_at)}
        </span>
      </Link>

      {/* Right — horizontal strip of real thumbnails, starting 60px from the
          title. pointer-events-none lets clicks on empty strip space fall
          through to the channel overlay; each thumbnail re-enables clicks and
          sits above the overlay (z-10). */}
      <div className="pointer-events-none flex items-center gap-3 overflow-hidden py-10 pl-5 pr-5 md:min-w-0 md:pl-0 md:pr-6">
        {thumbs.length === 0 ? (
          <div className="flex h-[340px] w-full items-center justify-center text-xs text-neutral-600">
            No blocks yet
          </div>
        ) : (
          thumbs.map((b) => (
            <Link
              key={b.id}
              href={`/block/${b.id}`}
              className="pointer-events-auto relative z-10 aspect-square h-[340px] w-[340px] shrink-0 overflow-hidden bg-neutral-900"
            >
              {b.image_url ? (
                <Image
                  src={b.image_url}
                  alt={b.title}
                  fill
                  sizes="(min-width: 768px) 400px, 50vw"
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
          />
        </div>
      </div>
    </div>
  );
}
