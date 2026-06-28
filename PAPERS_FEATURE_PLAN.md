# Plan: Research Papers in Svemir (copyright-safe, agent-analyzed, networked)

## Context

Tanja wants to add many research papers to Svemir as a content type that is
**mixed into** the normal archive yet **filterable on its own**, is
**copyright-safe** (public visitors see title + abstract + the analysis, but only
she — the authenticated owner — can read/download the full text), and is
**networked** so she can discover connections across papers along five
dimensions: (1) AI techniques, (2) UX/UI effects, (3) challenges, (4) metrics,
(5) ethical concerns.

**Decisions (confirmed):** ingest = **Markdown files** she converts from PDFs;
public view = **abstract + the 5-dimension analysis/network** (never full text);
**analysis is agent-driven — NO Claude API in the app.** Claude Code (me) reads
each `.md` and produces the 5 facets; a **one-time ingestion script** writes
everything into Supabase. The running app makes **zero LLM/network calls** —
consistent with Svemir's existing local, no-AI concept system. Tradeoff: adding
papers later means re-running the ingestion with me (fine for a batch import).

### Source corpus (found on Desktop)
- **`~/Desktop/PhD/Markdown library/`** — **330 papers** in 3 collections:
  *AI Personalization & SLR* (226), *Emotional Design* (78), *HCI & Adaptive
  Interfaces* (26). These folders → **channels**.
- **Each `.md` has YAML frontmatter** (`title`, `authors[]`, `year`, `journal`,
  `doi`, `keywords`, `concepts`, `topic`, `tags`) **+ an `## Abstract` section**.
  ⇒ **all metadata + abstract is mechanical to parse — no AI needed.** The only
  agent work is the **5 facets** per paper.
- ⇒ Decouple: the script ingests **all 330** (metadata + abstract + private full
  text + channel) with zero AI; **I** add the 5 facets in a **pilot scope first =
  "HCI & Adaptive Interfaces" (26 papers)** to validate the network end-to-end,
  then expand to Emotional Design and the SLR in later batches.

### Key constraints discovered (drive the design)
- **Owner vs public is a password cookie**, not Supabase Auth: `isAuthed()`
  ([lib/access-server.ts](svemir/lib/access-server.ts)) reads the `svemir_access` httpOnly cookie. Public
  reads use the **anon** client ([lib/supabase-client.ts](svemir/lib/supabase-client.ts)) under RLS; privileged
  reads/writes use **`supabaseAdmin`** (service role, bypasses RLS —
  [lib/supabase-server.ts](svemir/lib/supabase-server.ts)).
- **RLS can't gate by owner** (owner has no Supabase session), so **the app
  layer gates full text**: a server component checks `isAuthed()` and only then
  reads the text via `supabaseAdmin`. ⇒ **full text lives in a PRIVATE storage
  bucket**, never in a public `items` column (`items` is `select using(true)` —
  [0004_items_rls.sql](svemir/supabase/migrations/0004_items_rls.sql)).
- `items.kind` is a CHECK constraint `('link','image','text')` ([0001](svemir/supabase/migrations/0001_channels_and_connections.sql)) — add
  `'paper'` via a new migration.
- The repo already has `@supabase/supabase-js`; the ingestion script reuses it
  with the service-role key from `.env.local`. No new app dependencies.

> ⚠️ `svemir/AGENTS.md`: modified Next.js — read `svemir/node_modules/next/dist/docs/`
> before writing new routes / server components.

### Recheck (`/solve`) — verified against code, with refinements
- ✅ Copyright design is safe: public reads use the **anon client** + `select("*")`;
  full text is **never a column** (private bucket only), so it can't leak.
  `isAuthed()` reads cookies → **forces dynamic rendering**, so an owner render is
  never cached and served to the public.
- **`proxy.ts` IS the middleware** (there is no `middleware.ts`; it's
  matcher-activated). `/paper` and `/api/papers` aren't matched, so `/paper/[id]`
  is publicly viewable (good) and the **content route's own `isAuthed()` check is
  the real gate**. Optional proxy defense-in-depth = edit *both* its `GATED_PATHS`
  regex and `config.matcher`.
- **Frontmatter must be cleaned**: `authors`/`year`/`journal` are
  `[[wikilink]]`-wrapped (and sometimes empty `[]`/`""`). Use **`gray-matter`**
  (script-only dep) for the YAML + a `cleanWiki()` helper to strip `[[ ]]`/quotes
  and coerce `year`→int.
- **324/330 papers have `## Abstract`** (226→225, 78→75, 26→24) → ~6 need the
  first-~1500-chars fallback. Real, small edge case.
- **Pre-create the 3 channels once** (cache ids), not per-paper, to avoid
  redundant `ensureChannelId` insert races.
- Public paper detail can **reuse `getBlockWithChannels`** ([lib/queries.ts](svemir/lib/queries.ts), anon)
  for the safe fields; full text fetched separately via `supabaseAdmin`.

---

## Architecture (3 phases)

Papers are a new **`kind: "paper"`** on `items` → they mix into the Blocks grid
and existing graph for free, and a `kind` filter gives the separate "Papers"
view.

### Phase 1 — Data model + agent-driven ingestion (no API)

**Migration `svemir/supabase/migrations/0007_papers.sql`** (idempotent, mirror
existing style):
- Extend `items_kind_check` to include `'paper'` (drop + re-add).
- `alter table items add column if not exists` → `paper_authors text[]`,
  `paper_year smallint`, `paper_full_text_path text`. Reuse existing columns:
  `description`=abstract, `source_name`=venue, `url`=DOI/link.
- **Facet tables**, mirroring `concepts`/`block_concepts` ([0006](svemir/supabase/migrations/0006_concepts_and_fts.sql)):
  - `paper_facets (id, dimension text, value text, slug text unique, paper_count int default 0, created_at)`, CHECK `dimension in ('ai_technique','ux_effect','challenge','metric','ethical_concern')`, unique `(dimension, lower(value))`.
  - `paper_facet_links (paper_id → items(id) on delete cascade, facet_id → paper_facets(id) on delete cascade, primary key (paper_id, facet_id))`.
  - Enable RLS, `for select using (true)` on both (derived metadata is
    public-safe per the decision); no write policies — same posture as concepts.
- End the migration with `notify pgrst, 'reload schema';` (PostgREST cache,
  matching the 0006 convention) so the new tables/columns appear immediately.

**Private storage bucket `papers`** — created (with `public: false`) by the
ingestion script using `supabaseAdmin.storage.createBucket`, mirroring
`ensureBucket()` ([api/upload-image/route.ts:19-37](svemir/app/api/upload-image/route.ts#L19-L37)). Full text is only ever
read back via `supabaseAdmin`.

**`svemir/lib/paper-facets.ts`** — mirror [lib/concepts.ts](svemir/lib/concepts.ts):
`ensureFacet(client, dimension, value)` (insert-then-lookup on `(dimension,
lower(value))`, slugify with a dimension prefix), `reconcilePaperFacets(client,
paperId, facets)` (clear → re-link → `refreshFacetCounts`). Importable by both
the script and any future code.

**Ingestion (the "no API" part) — two decoupled steps:**

*Step A — mechanical ingest of ALL 330 (zero AI), `svemir/scripts/ingest-papers.mjs`*
(run with `node`, reads `.env.local`):
1. Ensure the private `papers` bucket (`public:false`).
2. **Pre-create the 3 channels once** (one `ensureChannelId` per collection,
   cache the ids) to avoid per-paper races.
3. Walk the source dir (default `~/Desktop/PhD/Markdown library/`, overridable),
   and per `.md`: parse with **`gray-matter`** (frontmatter) + extract the
   `## Abstract` section (fallback: first ~1500 chars for the ~6 papers without
   one); run values through **`cleanWiki()`** to strip `[[ ]]`/quotes and coerce
   `year`→int and `authors`→`string[]` (handle empty `[]`/`""`). Upload the `.md`
   to `papers/${uuid}.md`, insert the `items` row (kind=`paper`,
   abstract→`description`, journal→`source_name`, doi→`url`, `paper_authors`,
   `paper_year`, `paper_full_text_path`), and connect it to its collection's
   cached channel id. Idempotent per source path (skip if already imported).
   Prints a per-collection summary.
   - Optional: run the existing concept extraction on title+abstract so papers
     also appear in the current **Map** graph.

*Step B — facet analysis (only I can do this):* I read each paper and produce
`{ sourcePath, aiTechniques[], uxEffects[], challenges[], metrics[],
ethicalConcerns[] }` into **`svemir/scripts/paper-facets.json`** (short, canonical
facet values so they recur and connect papers). A second pass of the script (or a
small `apply-facets.mjs`) reads that file and calls `reconcilePaperFacets` for
each paper. Scope per the question below; can run in batches and grow over time.

> No `addPaper` server action, admin upload UI, `@anthropic-ai/sdk`, or
> `ANTHROPIC_API_KEY` — metadata is parsed from frontmatter, facets produced by
> me, ingestion done by the script.

### Phase 2 — Browsing + copyright-safe access control

- **Mixed**: a `kind:"paper"` branch in [BlockCard.tsx](svemir/components/BlockCard.tsx) (or a `PaperCard`) —
  paper-styled card (title, authors·year, abstract snippet, a "Paper" tag), since
  papers have no image. Papers already flow into the Blocks grid + graph.
- **Separate**: add `"papers"` to `ALLOWED_VIEWS` ([app/page.tsx:19-22](svemir/app/page.tsx#L19)) and to
  `VIEW_OPTIONS`/`ViewKind` ([FilterBar.tsx](svemir/components/FilterBar.tsx)) so the **Papers** tab renders in
  [ViewNav.tsx](svemir/components/ViewNav.tsx); add a `PapersRoute` in `app/page.tsx` querying `kind='paper'`
  → `PapersView`.
- **Detail page (access-control core)**: `svemir/app/paper/[id]/page.tsx`
  (+ `@modal` interceptor, mirroring [app/block/[id]](svemir/app/block/[id]/page.tsx)). Server component:
  fetch public fields (title, authors, abstract, facets) via the anon client;
  compute `canRead = await isAuthed()`; **only if `canRead`** read the markdown
  via `supabaseAdmin.storage.from("papers").download(path)` and pass it to
  `PaperDetail`. Public render = abstract + the 5 facet tag-groups; owner render
  adds the rendered full text + a download link. Full text is never in the public
  payload.
- **Gated download route** `svemir/app/api/papers/[id]/content/route.ts` —
  **primary gate**: in-route `isAuthed()` → 403 if not; else stream from the
  private bucket (`supabaseAdmin.storage.from("papers").download(path)`) or return
  a short-lived `createSignedUrl`. Optional defense-in-depth: add
  `/api/papers/:path*` to **both** `proxy.ts`'s `GATED_PATHS` regex and
  `config.matcher`.

### Phase 3 — The 5-dimension facet network

- Extend [app/graph/page.tsx](svemir/app/graph/page.tsx) to also fetch `kind='paper'` items +
  `paper_facet_links` + `paper_facets`.
- Add a **"Research"** mode to [GraphViewSwitcher.tsx](svemir/components/GraphViewSwitcher.tsx) (4th toggle) rendering a
  new `components/PaperFacetGraph.tsx`, **cloned from the just-shipped
  Obsidian-style [KnowledgeGraph.tsx](svemir/components/KnowledgeGraph.tsx)**: nodes = papers + facet hubs; each
  paper links to its facets; **color by dimension** (5 curated colors — add
  `facetColor(dimension)` to [lib/constants.ts](svemir/lib/constants.ts) beside `channelColor`); reuse
  straight subtle links, degree sizing, hover-highlight, click card. Papers
  sharing a facet cluster together → visible cross-paper connections.

---

## Reuse inventory
- `isAuthed()` / `supabaseAdmin` — auth gate + privileged I/O.
- `@supabase/supabase-js` (existing) — the ingestion script.
- `concepts.ts` (`ensureConcept`/`refreshConceptCounts`/`reconcileBlockConcepts`)
  — template for `paper-facets.ts`.
- `ensureBucket()` + `createSignedUrl` — private bucket + owner download.
- `KnowledgeGraph.tsx` + `channelColor`/palette — the facet network.
- `ViewNav`/`FilterBar`/`ALLOWED_VIEWS` + block detail & `@modal` interceptor —
  Papers tab + paper detail.

## Risks & edge cases
- **Copyright leak** — the must-get-right item: full text only via `supabaseAdmin`
  behind `isAuthed()`; bucket private; never selected by the anon/public query.
  Verified explicitly below.
- **Messy Markdown** — I extract metadata even without frontmatter; if no clear
  abstract, I fall back to the first ~1500 chars and flag that paper.
- **Facet naming drift** — I produce short canonical facet values so they recur;
  the script dedupes on `(dimension, lower(value))`.
- **Service-role key in a script** — `ingest-papers.mjs` reads `.env.local` and is
  run locally/one-off; never ship it to the client or commit secrets.
- **Future papers** — adding more later re-runs the agent-driven ingestion (or a
  small manual "add paper" form could be added then); no API path needed now.

## Verification
1. Migration: run `0007_papers.sql` in the Supabase SQL editor; confirm
   `kind='paper'` accepted and facet tables exist.
2. **Ingest**: with `.md` files in `svemir/papers-import/`, I generate
   `analysis.json`, then `node scripts/ingest-papers.mjs` → rows created, facets
   populated, `.md` files in the private `papers` bucket.
3. `cd svemir && npm run dev`. Paper cards appear in **Blocks** and under the new
   **Papers** tab.
4. **Copyright gate (critical)** — signed in: `/paper/[id]` shows abstract +
   facets + full text; `/api/papers/[id]/content` returns the file. **Signed out**
   (incognito / cleared `svemir_access` cookie): same paper shows abstract +
   facets **only**, no full text in the HTML/payload, and the content route
   returns **403**.
5. **Network**: Graph → **Research** shows papers linked by shared facets, colored
   by dimension; hover highlights a paper's facets + neighbors.
6. `npx tsc --noEmit` + `npx eslint` on changed files clean; run `/security-review`
   on the access-control diff before deploying.
