import Link from "next/link";

export type CloudConcept = {
  id: string;
  slug: string;
  term: string;
  count: number;
};

/**
 * The prevalence "word cloud" of recurring concepts, sized by how many blocks
 * mention each term. Presentational + hook-free, so it works in both a server
 * component (the /concepts page) and a client component (the graph's Concepts
 * tab). Each term links to its own /concept/[slug] page.
 */
export default function ConceptCloud({ concepts }: { concepts: CloudConcept[] }) {
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
  const sizeRem = (n: number) =>
    max === min ? 1.1 : 0.85 + ((n - min) / (max - min)) * 1.75;

  return (
    <ul className="flex flex-wrap items-baseline gap-x-4 gap-y-3">
      {concepts.map((c) => (
        <li key={c.id}>
          <Link
            href={`/concept/${c.slug}`}
            className="text-neutral-300 transition-colors hover:text-neutral-100"
            style={{ fontSize: `${sizeRem(c.count)}rem` }}
            title={`${c.count} block${c.count === 1 ? "" : "s"}`}
          >
            {c.term}
            <span className="ml-1 align-baseline text-xs text-neutral-600">
              {c.count}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
