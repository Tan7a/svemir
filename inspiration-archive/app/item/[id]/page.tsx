import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase-client";
import ArchiveCard from "@/components/ArchiveCard";
import {
  CATEGORY_PILL_CLASSES,
  SOURCE_TYPE_LETTER,
  colorForTag,
} from "@/lib/constants";
import type { Item, Tag, ItemWithTags } from "@/lib/types";

export const revalidate = 60;

type ItemRow = Item & {
  item_tags: { tags: Tag | null }[] | null;
};

function flattenTags(row: ItemRow): ItemWithTags {
  const { item_tags, ...rest } = row;
  const tags: Tag[] = (item_tags ?? [])
    .map((it) => it.tags)
    .filter((t): t is Tag => !!t);
  return { ...rest, tags };
}

export default async function ItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!supabase) {
    return (
      <div className="p-8 text-zinc-600">
        Supabase is not configured.
      </div>
    );
  }

  const { data: itemData, error } = await supabase
    .from("items")
    .select("*, item_tags(tags(*))")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <div className="p-8 text-red-600">
        Failed to load item: {error.message}
      </div>
    );
  }

  if (!itemData) notFound();

  const item = flattenTags(itemData as ItemRow);
  const tagIds = item.tags.map((t) => t.id);

  let related: ItemWithTags[] = [];
  if (tagIds.length > 0) {
    const { data: shareRows } = await supabase
      .from("item_tags")
      .select("item_id, tag_id")
      .in("tag_id", tagIds)
      .neq("item_id", id);

    const counts = new Map<string, number>();
    (shareRows ?? []).forEach((r) => {
      counts.set(r.item_id, (counts.get(r.item_id) ?? 0) + 1);
    });
    const topIds = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([itemId]) => itemId);

    if (topIds.length > 0) {
      const { data: relatedRows } = await supabase
        .from("items")
        .select("*, item_tags(tags(*))")
        .in("id", topIds);

      const order = new Map(topIds.map((tid, i) => [tid, i]));
      related = ((relatedRows ?? []) as ItemRow[])
        .map(flattenTags)
        .sort(
          (a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999)
        );
    }
  }

  const sourceLetter = SOURCE_TYPE_LETTER[item.source_type] ?? "○";

  return (
    <div className="min-h-screen bg-[#FBF8F4]">
      <header className="border-b border-zinc-200 bg-[#FBF8F4]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link
            href="/archive"
            className="text-sm text-zinc-600 hover:text-zinc-900"
          >
            ← Archive
          </Link>
          <Link
            href="/graph"
            className="text-sm text-zinc-600 hover:text-zinc-900"
          >
            Graph
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="grid gap-8 md:grid-cols-[3fr_2fr]">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border-4 border-white bg-white shadow-md">
            {item.image_url ? (
              <Image
                src={item.image_url}
                alt={item.title}
                fill
                sizes="(min-width: 768px) 60vw, 100vw"
                className="object-cover"
                priority
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-200 text-zinc-400">
                No image
              </div>
            )}
            <div className="absolute top-3 left-3 flex h-7 w-7 items-center justify-center rounded-full bg-black text-xs font-semibold text-white">
              {sourceLetter}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {item.source_name && (
              <p className="text-sm text-zinc-500">
                {item.source_name}
                {item.source_handle ? ` · ${item.source_handle}` : ""}
              </p>
            )}
            <h1 className="text-2xl font-semibold text-zinc-900 leading-tight">
              {item.title}
            </h1>
            {item.description && (
              <p className="text-sm text-zinc-700 leading-relaxed">
                {item.description}
              </p>
            )}
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Open original ↗
            </a>

            {(item.categories.length > 0 || item.tags.length > 0) && (
              <div className="flex flex-wrap gap-1.5 pt-2">
                {item.categories.map((cat) => (
                  <span
                    key={`c-${cat}`}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      CATEGORY_PILL_CLASSES[cat] ?? "bg-zinc-200 text-zinc-700"
                    }`}
                  >
                    {cat}
                  </span>
                ))}
                {item.tags.map((tag) => {
                  const c = colorForTag(tag.id);
                  return (
                    <span
                      key={`t-${tag.id}`}
                      className={`px-2.5 py-1 rounded-full text-xs ${c.bg} ${c.text}`}
                    >
                      #{tag.name}
                    </span>
                  );
                })}
              </div>
            )}

            {item.notes && (
              <div className="mt-2 rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 whitespace-pre-wrap">
                {item.notes}
              </div>
            )}
          </div>
        </div>

        <section className="mt-16">
          <h2 className="text-sm font-medium text-zinc-500 mb-4">
            Related {related.length > 0 ? `(${related.length})` : ""}
          </h2>
          {related.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No related items yet — add more entries with overlapping tags.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
              {related.map((r) => (
                <ArchiveCard key={r.id} item={r} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
