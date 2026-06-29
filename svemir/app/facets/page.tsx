import Link from "next/link";
import TopBar from "@/components/TopBar";
import { listFacets } from "@/lib/queries";
import { FACET_DIMENSIONS, FACET_DIMENSION_BY_KEY } from "@/lib/constants";

export const revalidate = 60;

/**
 * Facets index — every facet grouped by its dimension, each linking to its
 * facet panel. A directory for browsing the 5-dimension vocabulary.
 */
export default async function FacetsPage() {
  const facets = await listFacets();
  const byDimension = FACET_DIMENSIONS.map((d) => ({
    ...d,
    facets: facets.filter((f) => f.dimension === d.key),
  })).filter((g) => g.facets.length > 0);

  return (
    <>
      <TopBar />
      <main className="mx-auto min-h-[calc(100vh-3rem)] w-full max-w-5xl px-6 py-10">
        <header className="mb-10">
          <h1 className="text-3xl font-light text-neutral-100">Research</h1>
          <p className="mt-2 max-w-prose text-sm text-neutral-400">
            The research-paper collection, browsable by the five facet dimensions
            papers connect along. Click any facet to see what it means and every
            paper that carries it.
          </p>
        </header>

        {facets.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No facets yet — run the facet ingestion to populate them.
          </p>
        ) : (
          <div className="flex flex-col gap-9">
            {byDimension.map((g) => (
              <section key={g.key}>
                <h2
                  className={`mb-3 text-xs font-medium uppercase tracking-wide ${g.text}`}
                >
                  {g.label}
                  <span className="ml-2 text-neutral-600">{g.facets.length}</span>
                </h2>
                <div className="flex flex-wrap gap-2">
                  {g.facets.map((f) => {
                    const dim = FACET_DIMENSION_BY_KEY[f.dimension];
                    return (
                      <Link
                        key={f.slug}
                        href={`/facet/${f.slug}`}
                        className={`rounded-full border px-3 py-1 text-sm transition-colors hover:bg-neutral-900 ${dim?.border ?? "border-neutral-700"} ${dim?.text ?? "text-neutral-200"}`}
                      >
                        {f.value}
                        <span className="ml-1.5 text-neutral-500">
                          {f.paper_count}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
