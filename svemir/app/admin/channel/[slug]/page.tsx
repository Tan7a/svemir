import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isAuthed } from "@/lib/access-server";
import TopBar from "@/components/TopBar";
import BlocksView from "@/components/BlocksView";
import ChannelActions from "@/components/ChannelActions";
import { IconLock } from "@/components/ui/icons";
import { ITEM_CARD_COLUMNS } from "@/lib/types";
import type { CardItem, Channel } from "@/lib/types";

/**
 * Owner's mirror of /channel/[slug], for PRIVATE channels: the public page
 * uses the anon key, which (after migration 0012) cannot see a private
 * channel at all, so it 404s for everyone. This page reads with the
 * service-role key instead. Double-gated: the proxy Basic-Auths /admin, and
 * isAuthed() re-checks the session cookie. Per-request rendering (no ISR):
 * private content must never land in a shared cache.
 */
export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

export default async function AdminChannelPage({
  params,
}: {
  params: Params;
}) {
  const { slug } = await params;
  if (!(await isAuthed())) notFound();
  if (!supabaseAdmin) {
    return (
      <main className="p-8 text-sm text-neutral-400">
        Supabase admin is not configured.
      </main>
    );
  }

  type Row = Channel & {
    connections: { position: number; items: unknown }[] | null;
  };
  const { data } = await supabaseAdmin
    .from("channels")
    .select(`*, connections(position, items(${ITEM_CARD_COLUMNS}))`)
    .eq("slug", slug)
    .maybeSingle();
  if (!data) notFound();

  const row = data as unknown as Row;
  const blocks: CardItem[] = (row.connections ?? [])
    .map((c) => {
      const it = Array.isArray(c.items) ? c.items[0] : c.items;
      return { position: c.position, item: it as CardItem | undefined };
    })
    .filter((r): r is { position: number; item: CardItem } => !!r.item)
    .sort((a, b) => a.position - b.position)
    .map((r) => r.item);

  return (
    <>
      <TopBar />
      <div className="flex items-start justify-between gap-4 px-5 pt-8 pb-6">
        <div>
          <h1 className="flex items-baseline gap-3">
            <Link
              href="/"
              className="font-[family-name:var(--font-display)] text-3xl tracking-wider text-neutral-500 hover:text-neutral-200"
            >
              svemir
            </Link>
            <span className="text-3xl text-neutral-700">/</span>
            <span className="font-[family-name:var(--font-display)] text-3xl tracking-wider text-neutral-100">
              {row.title}
            </span>
            {row.is_private && (
              <span className="flex items-center gap-1 self-center rounded-full border border-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">
                <IconLock size={12} /> Private
              </span>
            )}
          </h1>
          {row.description && (
            <p className="mt-2 max-w-prose text-sm text-neutral-400">
              {row.description}
            </p>
          )}
          <p className="mt-3 text-xs text-neutral-500">
            {blocks.length} block{blocks.length === 1 ? "" : "s"} · only you
            can see this channel
          </p>
        </div>
        <div className="shrink-0">
          <ChannelActions
            channelId={row.id}
            channelTitle={row.title}
            channelSlug={row.slug}
            isPrivate={row.is_private === true}
            hasParent={row.parent_id !== null}
          />
        </div>
      </div>
      <main>
        {blocks.length === 0 ? (
          <div className="px-5 py-16 text-center text-sm text-neutral-500">
            No blocks in this channel yet.
          </div>
        ) : (
          <div className="pt-8">
            <BlocksView blocks={blocks} />
          </div>
        )}
      </main>
    </>
  );
}
