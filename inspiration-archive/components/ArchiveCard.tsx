import Image from "next/image";
import Link from "next/link";
import type { ItemWithTags } from "@/lib/types";
import {
  CATEGORY_PILL_CLASSES,
  SOURCE_TYPE_LETTER,
  colorForTag,
} from "@/lib/constants";

type Props = {
  item: ItemWithTags;
};

export default function ArchiveCard({ item }: Props) {
  const visibleCategories = item.categories.slice(0, 2);
  const overflowCategories = Math.max(
    0,
    item.categories.length - visibleCategories.length
  );
  const visibleTags = item.tags.slice(0, 3);
  const overflowTags = Math.max(0, item.tags.length - visibleTags.length);
  const sourceLetter = SOURCE_TYPE_LETTER[item.source_type] ?? "○";

  return (
    <Link href={`/item/${item.id}`} className="group block">
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
        <div className="absolute top-2 left-2 flex h-6 w-6 items-center justify-center rounded-full bg-black text-[10px] font-semibold text-white">
          {sourceLetter}
        </div>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-[12px] text-zinc-700 opacity-0 transition-opacity hover:bg-white group-hover:opacity-100"
          aria-label="Open original"
          title="Open original"
        >
          ↗
        </a>
      </div>
      <div className="mt-3 px-1">
        {item.source_name && (
          <p className="text-xs text-zinc-500">{item.source_name}</p>
        )}
        <h3 className="mt-0.5 text-sm font-medium text-zinc-900 line-clamp-2 leading-snug">
          {item.title}
        </h3>
        {(visibleCategories.length > 0 || visibleTags.length > 0) && (
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
            {visibleTags.map((tag) => {
              const c = colorForTag(tag.id);
              return (
                <span
                  key={`t-${tag.id}`}
                  className={`px-2 py-0.5 rounded-full text-[10px] ${c.bg} ${c.text}`}
                >
                  #{tag.name}
                </span>
              );
            })}
            {overflowTags > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-zinc-100 text-zinc-600">
                +{overflowTags}
              </span>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}
