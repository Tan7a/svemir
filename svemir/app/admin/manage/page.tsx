import { supabase } from "@/lib/supabase-client";
import AdminTabs from "@/components/AdminTabs";
import TopBar from "@/components/TopBar";
import ManageList from "@/components/ManageList";
import type { Item, Channel, ItemWithChannels } from "@/lib/types";

export const dynamic = "force-dynamic";

type ItemRow = Item & {
  connections: { channels: unknown }[] | null;
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
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? "1"));
  const q = (params.q ?? "").trim();

  if (!supabase) {
    return (
      <>
        <TopBar />
        <AdminTabs active="manage" />
        <main className="mx-auto max-w-6xl px-6 py-10 text-neutral-400">
          Supabase is not configured.
        </main>
      </>
    );
  }

  let query = supabase
    .from("items")
    .select("*, connections(channels(*))", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (q) {
    query = query.or(
      `title.ilike.%${q}%,description.ilike.%${q}%,url.ilike.%${q}%`
    );
  }

  const { data, error, count } = await query;

  if (error) {
    return (
      <>
        <TopBar />
        <AdminTabs active="manage" />
        <main className="mx-auto max-w-6xl px-6 py-10 text-red-400">
          Failed to load items: {error.message}
        </main>
      </>
    );
  }

  const items: ItemWithChannels[] = (
    (data ?? []) as unknown as ItemRow[]
  ).map((row) => {
    const { connections, ...rest } = row;
    const channels = (connections ?? []).flatMap((c) =>
      asChannelList(c.channels)
    );
    return { ...rest, channels };
  });

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const totalCount = count ?? 0;

  const missingMetaCount = items.filter(
    (i) => !i.image_url || !i.description
  ).length;

  return (
    <>
      <TopBar />
      <AdminTabs active="manage" />
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-light text-neutral-100">
            Manage{" "}
            <span className="ml-2 text-sm font-normal text-neutral-500">
              {totalCount} items
            </span>
          </h1>
          <p className="text-xs text-neutral-500">
            Page {page} of {totalPages}
            {missingMetaCount > 0 &&
              ` · ${missingMetaCount} missing metadata on this page`}
          </p>
        </div>

        <ManageList
          items={items}
          page={page}
          totalPages={totalPages}
          query={q}
        />
      </main>
    </>
  );
}
