import Link from "next/link";
import { textPaletteColor } from "@/lib/constants";

export type CloudConcept = {
  id: string;
  slug: string;
  term: string;
  count: number;
};

/**
 * The prevalence "word cloud" of recurring concepts, sized by how many blocks
 * mention each term. Presentational + hook-free, so it stays usable from both
 * server and client components; today it renders inside the Garden's concepts
 * panel (components/GardenShell.tsx). Each term links to /concept/[slug].
 *
 * `compact` caps the size ramp at ~1.6rem for narrow columns (the 320px
 * panel), where the full 2.6rem headline sizes would wrap one word per line.
 */
export default function ConceptCloud({
  concepts,
  compact = false,
}: {
  concepts: CloudConcept[];
  compact?: boolean;
}) {
  if (concepts.length === 0) {
    return (
      <p className="max-w-prose text-sm text-neutral-500">
        No concepts yet. Open{" "}
        <code className="rounded bg-neutral-900 px-1">/admin/manage</code> and run{" "}
        <span className="text-neutral-300">Extract concepts</span> to index your
        archive - it reads each block&apos;s text locally (no AI) and surfaces
        the terms you collect most.
      </p>
    );
  }

  const counts = concepts.map((c) => c.count);
  const max = Math.max(...counts);
  const min = Math.min(...counts);
  // Most prevalent → largest. rem so it scales with the root font.
  const sizeRem = (n: number) => {
    if (max === min) return compact ? 1 : 1.1;
    const ratio = (n - min) / (max - min);
    return compact ? 0.8 + ratio * 0.8 : 0.85 + ratio * 1.75;
  };

  return (
    <ul className="flex flex-wrap items-baseline gap-x-4 gap-y-3">
      {concepts.map((c) => (
        <li key={c.id}>
          <Link
            href={`/concept/${c.slug}`}
            className="transition-opacity hover:opacity-70"
            style={{
              fontSize: `${sizeRem(c.count)}rem`,
              // Seeded on the term, not the id, so a concept keeps its colour
              // even if re-indexing gives it a new row.
              color: textPaletteColor(c.term),
            }}
            title={`${c.count} block${c.count === 1 ? "" : "s"}`}
          >
            {c.term}
            {/* neutral-400, not 600: the count must read as light grey on the
                dark theme (and flips to a readable dark grey on light ramps). */}
            <span className="ml-1 align-baseline text-xs text-neutral-400">
              {c.count}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
