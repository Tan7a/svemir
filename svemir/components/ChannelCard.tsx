import Link from "next/link";
import Image from "next/image";
import type { ChannelWithBlocks } from "@/lib/types";
import ChannelActions from "./ChannelActions";

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
    <div className="group relative grid grid-cols-1 border border-neutral-800 transition-colors hover:border-white md:grid-cols-[1fr_2fr]">
      {/* Left — centred title + meta */}
      <Link
        href={`/channel/${channel.slug}`}
        className="flex flex-col items-center justify-center gap-1.5 px-8 py-16 text-center"
      >
        <span className="text-2xl font-light text-neutral-100">
          {channel.title}
        </span>
        <span className="text-xs text-neutral-500">by Tanja Radovanovic</span>
        <span className="text-xs text-neutral-500">
          {count} block{count === 1 ? "" : "s"}
        </span>
        <span className="text-xs text-neutral-500">
          {relativeTime(channel.created_at)}
        </span>
      </Link>

      {/* Right — horizontal strip of real thumbnails, no placeholders */}
      <div className="flex items-center gap-3 overflow-hidden px-6 py-6">
        {thumbs.length === 0 ? (
          <div className="flex h-32 w-full items-center justify-center text-xs text-neutral-600">
            No blocks yet
          </div>
        ) : (
          thumbs.map((b) => (
            <Link
              key={b.id}
              href={`/block/${b.id}`}
              className="relative aspect-square h-32 w-32 shrink-0 overflow-hidden bg-neutral-900"
            >
              {b.image_url ? (
                <Image
                  src={b.image_url}
                  alt={b.title}
                  fill
                  sizes="128px"
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

      {/* Hover-revealed actions menu */}
      <div className="pointer-events-none absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
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
