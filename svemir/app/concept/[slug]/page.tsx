import { notFound } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase-client";
import TopBar from "@/components/TopBar";
import BlocksView from "@/components/BlocksView";
import type { Item } from "@/lib/types";

export const revalidate = 60;

type Params = Promise<{ slug: string }>;

/**
 * A single concept's page: every block that mentions it, most-relevant first
 * (by term frequency within the block). Modeled on the channel detail route —
 * async params, a nested select, and the shared BlocksView grid.
 */
export default async function ConceptPage({ params }: { params: Params }) {
  const { slug } = await params;

  if (!supabase) {
    return (
      <>
        <TopBar />
        <main className="p-8 text-sm text-neutral-400">
          Supabase is not configured.
        </main>
      </>
    );
  }
  const client = supabase;

  type ConceptWithBlocks = {
    id: string;
    slug: string;
    term: string;
    block_count: number;
    block_concepts: { tf: number; items: unknown }[] | null;
  };

  const { data: conceptRow } = await client
    .from("concepts")
    .select("id, slug, term, block_count, block_concepts(tf, items(*))")
    .eq("slug", slug)
    .maybeSingle();

  if (!conceptRow) notFound();
  const concept = conceptRow as unknown as ConceptWithBlocks;

  const blocks: Item[] = (concept.block_concepts ?? [])
    .map((row) => {
      const it = row.items;
      const item = Array.isArray(it) ? it[0] : it;
      return { tf: row.tf, item: item as Item | undefined };
    })
    .filter((r): r is { tf: number; item: Item } => !!r.item)
    .sort((a, b) => b.tf - a.tf)
    .map((r) => r.item);

  return (
    <>
      <TopBar />
      <div className="border-b border-neutral-900">
        <div className="px-5 pt-8 pb-6">
          <h1 className="flex items-baseline gap-3">
            <Link
              href="/concepts"
              className="font-[family-name:var(--font-display)] text-3xl tracking-wider text-neutral-500 hover:text-neutral-200"
            >
              concepts
            </Link>
            <span className="text-3xl text-neutral-700">/</span>
            <span className="font-[family-name:var(--font-display)] text-3xl tracking-wider text-neutral-100">
              {concept.term}
            </span>
          </h1>
          <p className="mt-3 text-xs text-neutral-500">
            {blocks.length} block{blocks.length === 1 ? "" : "s"} mention this
          </p>
        </div>
      </div>

      <main>
        {blocks.length === 0 ? (
          <div className="px-5 py-16 text-center text-sm text-neutral-500">
            No blocks mention this concept yet.
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
