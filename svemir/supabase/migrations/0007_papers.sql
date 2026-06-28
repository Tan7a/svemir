-- svemir — migration 0007: research papers + the 5-dimension facet network
--
-- Adds a new content kind ('paper') and the metadata/facet layer behind it.
-- Papers are just `items` with `kind = 'paper'`, so they mix into the Blocks
-- grid and the existing graph for free; the new columns + facet tables give
-- them their own metadata and the cross-paper "facet network".
--
-- NO AI/LLM here (or anywhere in the app): paper metadata is parsed from each
-- Markdown file's frontmatter by scripts/ingest-papers.mjs, and the 5 facets
-- are produced by Claude Code and written via lib/paper-facets.ts. The full
-- text never lives in a column — it goes to a PRIVATE storage bucket and is
-- only ever read back through the service-role client behind isAuthed().
--
-- Additive and idempotent (IF NOT EXISTS / DROP ... IF EXISTS throughout).
-- Safe to re-run. Run this in the Supabase SQL editor.
--
-- After running, Supabase reloads the PostgREST schema cache automatically. The
-- closing `notify pgrst` (matching 0006) forces it so the new tables/columns
-- appear immediately.

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Allow kind = 'paper'
-- ────────────────────────────────────────────────────────────────────────────
-- 0001 created items_kind_check as ('link','image','text'). A CHECK constraint
-- can't be altered in place, so drop and re-add with 'paper' included. The
-- DROP ... IF EXISTS keeps this re-runnable.

alter table items drop constraint if exists items_kind_check;
alter table items add constraint items_kind_check
  check (kind in ('link', 'image', 'text', 'paper'));

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Paper-specific columns on items
-- ────────────────────────────────────────────────────────────────────────────
-- Reuse existing columns where they fit:  description = abstract,
-- source_name = venue/journal,  url = DOI/link. These three are paper-only:
--   paper_authors         — cleaned author list (frontmatter authors[])
--   paper_year            — publication year
--   paper_full_text_path  — object path inside the private `papers` bucket;
--                           also the idempotency key for the ingestion script.

alter table items add column if not exists paper_authors        text[];
alter table items add column if not exists paper_year           smallint;
alter table items add column if not exists paper_full_text_path text;

-- Speeds up the kind='paper' filter behind the separate "Papers" view and the
-- graph's Research mode. Cheap and idempotent.
create index if not exists items_kind_idx on items (kind);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Facet layer  (mirrors concepts / block_concepts from 0006)
-- ────────────────────────────────────────────────────────────────────────────
-- One row per canonical facet value, scoped to one of five dimensions. `value`
-- is the human-facing display form; `slug` (dimension-prefixed) is for any
-- future /facet/[slug] page; `paper_count` is denormalized prevalence (how many
-- papers carry the facet) — refreshed by lib/paper-facets.ts, the same per-row
-- way concepts.block_count is (Supabase "safe update" mode rejects a WHERE-less
-- UPDATE, so a set-based recompute can't be used).

create table if not exists paper_facets (
  id          uuid primary key default gen_random_uuid(),
  dimension   text not null
              check (dimension in ('ai_technique','ux_effect','challenge','metric','ethical_concern')),
  value       text not null,
  slug        text unique not null,
  paper_count int  not null default 0,
  created_at  timestamptz not null default now()
);

-- Dedup key: one facet per (dimension, case-insensitive value). An expression
-- index (lower(value)) is why this is a unique INDEX, not a table constraint.
create unique index if not exists paper_facets_dim_value_idx
  on paper_facets (dimension, lower(value));

create index if not exists paper_facets_count_idx on paper_facets (paper_count desc);

-- paper ↔ facet links. Composite PK prevents a paper carrying the same facet
-- twice; both FKs cascade so deleting a paper (or a facet) cleans up its links.
create table if not exists paper_facet_links (
  paper_id uuid not null references items(id)        on delete cascade,
  facet_id uuid not null references paper_facets(id) on delete cascade,
  primary key (paper_id, facet_id)
);

create index if not exists paper_facet_links_facet_idx on paper_facet_links (facet_id);
create index if not exists paper_facet_links_paper_idx on paper_facet_links (paper_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. RLS — public select; service role bypasses RLS for writes (matches 0006)
-- ────────────────────────────────────────────────────────────────────────────
-- Facets are derived, copyright-safe metadata (no full text), so they're
-- public-readable. No write policy: anon is denied, the ingestion script's
-- service-role client bypasses RLS. The full text is protected separately by
-- living in a private bucket, never in these tables.

alter table paper_facets      enable row level security;
alter table paper_facet_links enable row level security;

drop policy if exists "paper_facets are public" on paper_facets;
create policy "paper_facets are public" on paper_facets for select using (true);

drop policy if exists "paper_facet_links are public" on paper_facet_links;
create policy "paper_facet_links are public" on paper_facet_links for select using (true);

-- Reload PostgREST's schema cache so the new columns/tables are queryable now.
notify pgrst, 'reload schema';

commit;
