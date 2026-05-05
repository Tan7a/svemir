"use client";

import Image from "next/image";
import type { ItemWithChannels } from "@/lib/types";
import { CATEGORY_PILL_CLASSES, colorForTag } from "@/lib/constants";

type Props = {
  item: ItemWithChannels;
  onOpen?: () => void;
};

export default function ArchiveCard({ item, onOpen }: Props) {
  const visibleCategories = item.categories.slice(0, 2);
  const overflowCategories = Math.max(
    0,
    item.categories.length - visibleCategories.length
  );
  const visibleChannels = item.channels.slice(0, 3);
  const overflowChannels = Math.max(
    0,
    item.channels.length - visibleChannels.length
  );

  function handleClick(e: React.MouseEvent) {
    if (onOpen) {
      e.preventDefault();
      onOpen();
    }
  }

  return (
    <div className="group relative">
      <a
        href={`/item/${item.id}`}
        onClick={handleClick}
        className="block cursor-pointer"
      >
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border-4 border-white bg-white shadow-sm transition-shadow group-hover:shadow-lg">
          {item.image_url ? (
            <Image
              src={item.image_url}
              alt={item.title}
              fill
              sizes="(min-width: 1280px) 20vw, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-200 text-zinc-400">
              <span className="text-xs">No image</span>
            </div>
          )}
        </div>
        <div className="mt-3 px-1">
          {item.source_name && (
            <p className="text-xs text-zinc-500">{item.source_name}</p>
          )}
          <h3 className="mt-0.5 text-sm font-medium text-zinc-900 line-clamp-2 leading-snug">
            {item.title}
          </h3>
          {(visibleCategories.length > 0 || visibleChannels.length > 0) && (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {visibleCategories.map((cat) => (
                <span
                  key={`c-${cat}`}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                    CATEGORY_PILL_CLASSES[cat] ?? "bg-zinc-200 text-zinc-700"
                  }`}
                >
                  {cat}
                </span>
              ))}
              {overflowCategories > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-200 text-zinc-700">
                  +{overflowCategories}
                </span>
              )}
              {visibleChannels.map((ch) => {
                const c = colorForTag(ch.id);
                return (
                  <span
                    key={`ch-${ch.id}`}
                    className={`px-2 py-0.5 rounded-full text-[10px] ${c.bg} ${c.text}`}
                  >
                    {ch.name}
                  </span>
                );
              })}
              {overflowChannels > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-zinc-100 text-zinc-600">
                  +{overflowChannels}
                </span>
              )}
            </div>
          )}
        </div>
      </a>
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute top-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-[12px] text-zinc-700 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100"
        aria-label="Open original"
        title="Open original"
      >
        ↗
      </a>
    </div>
  );
}
