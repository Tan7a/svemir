import Link from "next/link";
import Image from "next/image";
import type { Channel } from "@/lib/types";

type Props = {
  channel: Channel;
  itemCount: number;
  thumbnails: (string | null)[];
};

export default function ChannelCard({ channel, itemCount, thumbnails }: Props) {
  const tiles = thumbnails.slice(0, 4);
  while (tiles.length < 4) tiles.push(null);

  return (
    <Link
      href={`/channel/${channel.slug}`}
      className="group block rounded-xl border border-zinc-200 bg-white p-3 hover:shadow-md transition-shadow"
    >
      <div className="grid aspect-[4/3] w-full grid-cols-2 grid-rows-2 gap-1 overflow-hidden rounded-md bg-zinc-50">
        {tiles.map((url, i) => (
          <div key={i} className="relative bg-zinc-100">
            {url ? (
              <Image
                src={url}
                alt=""
                fill
                sizes="(min-width: 1024px) 20vw, 33vw"
                className="object-cover"
              />
            ) : (
              <div className="h-full w-full bg-gradient-to-br from-zinc-100 to-zinc-200" />
            )}
          </div>
        ))}
      </div>
      <div className="mt-3">
        <h3 className="text-sm font-medium text-zinc-900 line-clamp-1">
          {channel.name}
        </h3>
        <p className="text-xs text-zinc-500">
          {itemCount} {itemCount === 1 ? "block" : "blocks"}
        </p>
        {channel.description && (
          <p className="mt-1 text-xs text-zinc-600 line-clamp-2">
            {channel.description}
          </p>
        )}
      </div>
    </Link>
  );
}
