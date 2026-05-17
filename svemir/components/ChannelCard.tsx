import Link from "next/link";
import Image from "next/image";
import type { ChannelWithBlocks } from "@/lib/types";

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

/**
 * One channel as a horizontal row. Title + meta on the left, horizontal
 * thumbnail strip on the right (first ~5 blocks).
 */
export default function ChannelCard({ channel }: Props) {
  const thumbs = channel.blocks.slice(0, 5);
  const count = channel.block_count;

  return (
    <div className="grid grid-cols-[16rem_1fr] gap-6 border border-neutral-800 px-6 py-8">
      <div className="flex flex-col justify-center gap-1.5">
        <Link
          href={`/channel/${channel.slug}`}
          className="text-2xl font-light leading-tight text-neutral-100 hover:underline"
        >
          {channel.title}
        </Link>
        <p className="text-xs text-neutral-500">
          by Tanja Radovanovic
        </p>
        <p className="text-xs text-neutral-500">
          {count} block{count === 1 ? "" : "s"}
        </p>
        <p className="text-xs text-neutral-500">
          {relativeTime(channel.created_at)}
        </p>
      </div>
      <div className="flex items-center gap-3 overflow-hidden">
        {thumbs.length === 0 ? (
          <div className="text-xs text-neutral-600">No blocks yet</div>
        ) : (
          thumbs.map((b) => (
            <Link
              key={b.id}
              href={`/block/${b.id}`}
              className="relative h-32 w-32 shrink-0 overflow-hidden border border-neutral-800 bg-neutral-900"
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
                <div className="flex h-full w-full items-center justify-center bg-neutral-900 p-2 text-[9px] leading-snug text-neutral-400">
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
    </div>
  );
}
