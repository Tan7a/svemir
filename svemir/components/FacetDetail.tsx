import Link from "next/link";
import type { FacetWithPapers } from "@/lib/types";
import { FACET_DIMENSION_BY_KEY } from "@/lib/constants";

type Props = {
  facet: FacetWithPapers;
  inModal?: boolean;
};

/**
 * Facet panel — opened by clicking a facet tag. Shows what the tag means
 * (definition) and how each paper relates to it (the per-paper note), which is
 * also the "all papers with this tag" browse view. Public-safe: definitions and
 * notes are derived metadata, never full text.
 */
export default function FacetDetail({ facet, inModal = false }: Props) {
  const dim = FACET_DIMENSION_BY_KEY[facet.dimension];

  return (
    <div
      className={
        inModal
          ? "relative flex h-full flex-col gap-6 px-6 py-6"
          : "relative mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-3xl flex-col gap-6 px-6 py-8"
      }
    >
      <header className="flex flex-col gap-3">
        <span
          className={`w-fit rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-wide ${dim?.border ?? "border-neutral-700"} ${dim?.text ?? "text-neutral-300"}`}
        >
          {dim?.label ?? facet.dimension}
        </span>
        <h1 className="text-3xl font-light leading-tight text-neutral-100">
          {facet.value}
        </h1>
        {facet.definition && (
          <p className="max-w-prose text-[15px] leading-relaxed text-neutral-300">
            {facet.definition}
          </p>
        )}
        <div className="flex items-center gap-4 text-xs">
          <span className="text-neutral-500">
            {facet.papers.length} paper{facet.papers.length === 1 ? "" : "s"} carry this facet
          </span>
          <Link
            href={`/?facet=${facet.slug}`}
            className="text-neutral-400 hover:text-neutral-100"
          >
            View in grid →
          </Link>
        </div>
      </header>

      <div className="flex flex-col">
        <div className="border-b border-neutral-800 pb-1.5 text-xs text-neutral-500">
          In these papers
        </div>
        <ul className="divide-y divide-neutral-900">
          {facet.papers.map((p) => (
            <li key={p.id} className="py-3.5">
              <Link
                href={`/block/${p.id}`}
                className="text-[15px] font-medium leading-snug text-neutral-100 hover:underline"
              >
                {p.title || "Untitled"}
              </Link>
              <p className="mt-0.5 text-[11px] text-neutral-500">
                {[
                  (p.paper_authors ?? []).slice(0, 2).join(", ") +
                    ((p.paper_authors?.length ?? 0) > 2 ? " et al." : ""),
                  p.paper_year,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {p.note && (
                <p className="mt-1.5 text-sm leading-relaxed text-neutral-300">
                  {p.note}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>

      {!inModal && (
        <div className="mt-auto flex gap-4 pt-6 text-xs text-neutral-500">
          <Link href="/facets" className="hover:text-neutral-200">
            ← all facets
          </Link>
          <Link href="/" className="hover:text-neutral-200">
            svemir
          </Link>
        </div>
      )}
    </div>
  );
}
