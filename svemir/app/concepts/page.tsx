import Link from "next/link";
import { supabase } from "@/lib/supabase-client";
import TopBar from "@/components/TopBar";
import ConceptCloud from "@/components/ConceptCloud";

export const revalidate = 60;

type ConceptRow = {
  id: string;
  slug: string;
  term: string;
  block_count: number;
};

/**
 * The prevalence view - the "second brain" overview. Shows the concepts that
 * recur most across the archive, sized by how many blocks mention them. Each
 * links to its own page listing those blocks. Concept data is produced locally
 * (no AI) by the extractor; run "Extract concepts" in /admin/manage to populate.
 */
export default async function ConceptsPage() {
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

  // Only "recurring" concepts - those mentioned in 2+ blocks. A concept in a
  // single block is just a tag on that block, not a thread through the archive.
  const { data, error } = await supabase
    .from("concepts")
    .select("id, slug, term, block_count")
    .gte("block_count", 2)
    .order("block_count", { ascending: false })
    .limit(200);

  const concepts = (data ?? []) as ConceptRow[];

  return (
    <>
      <TopBar />
      <div className="border-b border-neutral-900">
        <div className="px-5 pt-8 pb-6">
          <h1 className="flex items-baseline gap-3">
            <Link
              href="/"
              className="font-[family-name:var(--font-display)] text-3xl tracking-wider text-neutral-500 hover:text-neutral-200"
            >
              svemir
            </Link>
            <span className="text-3xl text-neutral-700">/</span>
            <span className="font-[family-name:var(--font-display)] text-3xl tracking-wider text-neutral-100">
              concepts
            </span>
          </h1>
          <p className="mt-3 text-xs text-neutral-500">
            {concepts.length} recurring concept
            {concepts.length === 1 ? "" : "s"} · sized by prevalence
          </p>
        </div>
      </div>

      <main className="px-5 py-8">
        {error ? (
          <p className="text-sm text-red-400">
            Failed to load concepts: {error.message}
          </p>
        ) : (
          <ConceptCloud
            concepts={concepts.map((c) => ({
              id: c.id,
              slug: c.slug,
              term: c.term,
              count: c.block_count,
            }))}
          />
        )}
      </main>
    </>
  );
}
