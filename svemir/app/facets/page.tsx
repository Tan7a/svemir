import Link from "next/link";
import TopBar from "@/components/TopBar";
import BlocksView from "@/components/BlocksView";
import { listFacets } from "@/lib/queries";
import { supabase } from "@/lib/supabase-client";
import { FACET_DIMENSIONS } from "@/lib/constants";
import type { BlockWithChannelTags, ChannelTag, Item } from "@/lib/types";

export const revalidate = 60;

/** Orders that render the papers themselves as a block grid. */
const PAPER_ORDERS = new Set(["newest", "oldest", "alphabetical", "source"]);

type SP = Promise<{ order?: string }>;

/**
 * Research index. Default "By theme" view = the 5-dimension theme directory
 * (unchanged). Other orders (Newest / Oldest / A-Z / By source) render the
 * research papers as a browsable block grid - same intro, different lens.
 */
export default async function FacetsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const order = sp?.order && PAPER_ORDERS.has(sp.order) ? sp.order : "themes";

  return (
    <>
      <TopBar />
      <main className="mx-auto min-h-[calc(100vh-3rem)] w-full max-w-5xl px-6 py-10">
        <header className="max-w-prose">
          <h1 className="font-[family-name:var(--font-display)] text-5xl tracking-wider text-neutral-100">
            Research
          </h1>
          <div className="mt-4 flex flex-col gap-4 text-[15px] leading-relaxed text-neutral-300">
            <p>
              I&rsquo;m finishing a PhD on{" "}
              <span className="text-neutral-100">user control in AI interfaces</span>.
              I surveyed 360 people across 46 countries and reviewed a decade of
              AI-UX research; the resulting papers are now under peer review at top
              HCI journals. The recurring finding: people want{" "}
              <span className="text-neutral-100">
                clarity, refinement tools, and better personalization
              </span>{" "}
              - insight that shapes everything I design, including the product I
              lead,{" "}
              <a
                href="https://flero.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-100 underline decoration-neutral-700 underline-offset-2 hover:decoration-neutral-400"
              >
                flero.ai
              </a>
              .
            </p>
            <p className="text-neutral-400">
              This is the reading behind that work - every paper I&rsquo;ve
              collected, mapped across five dimensions of AI-UX research. Browse by
              theme to see what each means, or switch the lens to read the papers
              as a grid. More about me at{" "}
              <a
                href="https://tanjaradovanovic.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-200 underline decoration-neutral-700 underline-offset-2 hover:decoration-neutral-400"
              >
                tanjaradovanovic.com
              </a>
              .
            </p>
          </div>
        </header>

        <div className="mt-10">
          {order === "themes" ? <ThemesDirectory /> : <PapersGrid order={order} />}
        </div>
      </main>
    </>
  );
}

/** The default view: every theme grouped by its dimension. */
async function ThemesDirectory() {
  const facets = await listFacets();
  const byDimension = FACET_DIMENSIONS.map((d) => ({
    ...d,
    facets: facets.filter((f) => f.dimension === d.key),
  })).filter((g) => g.facets.length > 0);

  if (facets.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        No themes yet - run the ingestion to populate them.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-9">
      {byDimension.map((g) => (
        <section key={g.key}>
          <h2 className="mb-4 text-lg font-semibold text-neutral-100">
            {g.label}
            <span className="ml-2 text-sm font-normal text-neutral-500">
              {g.facets.length}
            </span>
          </h2>
          <div className="flex flex-wrap gap-2">
            {g.facets.map((f) => (
              <Link
                key={f.slug}
                href={`/facet/${f.slug}`}
                className="rounded-full border border-neutral-700 px-4 py-2 text-[15px] text-neutral-100 transition-colors hover:bg-neutral-900"
              >
                {f.value}
                <span className="ml-2 text-neutral-500">{f.paper_count}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** A raw items row with the embedded channels join. */
type PaperRow = Item & { connections: { channels: unknown }[] | null };

/** Flatten a row's embedded connections into a unique list of channel tags. */
function channelsFromRow(row: PaperRow): ChannelTag[] {
  const out: ChannelTag[] = [];
  const seen = new Set<string>();
  for (const conn of row.connections ?? []) {
    const raw = conn.channels;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const ch of list as ChannelTag[]) {
      if (ch?.slug && !seen.has(ch.slug)) {
        seen.add(ch.slug);
        out.push({ slug: ch.slug, title: ch.title });
      }
    }
  }
  return out;
}

/** The alternate view: research papers as a sortable block grid. */
async function PapersGrid({ order }: { order: string }) {
  if (!supabase) return null;

  let query = supabase
    .from("items")
    .select("*, connections(channels(slug, title))")
    .eq("kind", "paper")
    .limit(500);
  switch (order) {
    case "oldest":
      query = query.order("created_at", { ascending: true });
      break;
    case "alphabetical":
      query = query.order("title", { ascending: true });
      break;
    case "source":
      query = query.order("source_name", { ascending: true, nullsFirst: false });
      break;
    case "newest":
    default:
      query = query.order("created_at", { ascending: false });
      break;
  }

  const { data, error } = await query;
  if (error) {
    return (
      <p className="text-sm text-red-400">Failed to load papers: {error.message}</p>
    );
  }

  const papers: BlockWithChannelTags[] = ((data ?? []) as PaperRow[]).map(
    (row) => {
      const { connections: _c, ...item } = row;
      void _c;
      return { ...(item as Item), channels: channelsFromRow(row) };
    }
  );

  // BlocksView owns its own horizontal padding, so pull the grid out of the
  // page's px-6 gutter for an edge-to-edge wall.
  return (
    <div className="-mx-6">
      <BlocksView blocks={papers} />
    </div>
  );
}
