import { supabase } from "@/lib/supabase-client";
import AdminNav from "@/components/AdminNav";
import ManageList from "@/components/ManageList";
import type { Item, Channel, ItemWithChannels } from "@/lib/types";

export const dynamic = "force-dynamic";

type ItemRow = Item & {
  item_channels: { channels: unknown }[] | null;
};

function asChannelList(raw: unknown): Channel[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as Channel[];
  return [raw as Channel];
}

const PAGE_SIZE = 50;

export default async function ManagePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; view?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? "1"));
  const q = (params.q ?? "").trim();
  const view: "list" | "grid" = params.view === "grid" ? "grid" : "list";

  if (!supabase) {
    return (
      <div className="min-h-screen bg-[#FBF8F4]">
        <AdminNav active="manage" />
        <main className="mx-auto max-w-6xl px-6 py-10 text-zinc-600">
          Supabase is not configured.
        </main>
      </div>
    );
  }

  let query = supabase
    .from("items")
    .select("*, item_channels(channels(*))", { count: "exact" })
    .order("created_at", { ascending: false });

  if (view === "list") {
    query = query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  }

  if (q) {
    query = query.or(
      `title.ilike.%${q}%,description.ilike.%${q}%,url.ilike.%${q}%`
    );
  }

  const { data, error, count } = await query;

  if (error) {
    return (
      <div className="min-h-screen bg-[#FBF8F4]">
        <AdminNav active="manage" />
        <main className="mx-auto max-w-6xl px-6 py-10 text-red-600">
          Failed to load items: {error.message}
        </main>
      </div>
    );
  }

  const items: ItemWithChannels[] = ((data ?? []) as unknown as ItemRow[]).map(
    (row) => {
      const { item_channels, ...rest } = row;
      const channels = (item_channels ?? []).flatMap((it) =>
        asChannelList(it.channels)
      );
      return { ...rest, channels };
    }
  );

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const totalCount = count ?? 0;

  const missingMetaCount = items.filter(
    (i) => !i.image_url || !i.description
  ).length;

  return (
    <div className="min-h-screen bg-[#FBF8F4]">
      <AdminNav active="manage" />
      <main className="mx-auto max-w-6xl px-6 py-8 space-y-6">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-bold">
            Manage{" "}
            <span className="ml-2 text-sm font-normal text-zinc-500">
              {totalCount} items
            </span>
          </h1>
          <p className="text-xs text-zinc-500">
            {view === "list" && (
              <>
                Page {page} of {totalPages}
                {missingMetaCount > 0 &&
                  ` · ${missingMetaCount} missing metadata on this page`}
              </>
            )}
          </p>
        </div>

        <ManageList
          items={items}
          page={page}
          totalPages={totalPages}
          query={q}
          view={view}
        />
      </main>
    </div>
  );
}
