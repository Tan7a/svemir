-- svemir — migration 0006: concept layer + full-text search
--
-- A Graphiti-inspired knowledge layer, built natively in Postgres. No AI/LLM,
-- no embeddings, no extra services — term extraction happens in TypeScript and
-- writes into the tables below.
--
-- Additive and idempotent (IF NOT EXISTS / CREATE OR REPLACE throughout).
-- Safe to re-run. Run this in the Supabase SQL editor.
--
-- After running, Supabase reloads the PostgREST schema cache automatically. If
-- new tables/functions don't show up, run:  notify pgrst, 'reload schema';

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Full-text search on items  (Phase 0 — "smarter search")
-- ────────────────────────────────────────────────────────────────────────────
-- A GENERATED column keeps the search vector in sync automatically (no trigger
-- needed). Weighting: title=A (most important) down to body_text=D. The
-- explicit 'english' config is REQUIRED — it makes to_tsvector IMMUTABLE, which
-- a generated column demands. 'english' also gives stemming (graph≈graphs).

alter table items
  add column if not exists search_tsv tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')),       'A') ||
    setweight(to_tsvector('english', coalesce(description, '')),  'B') ||
    setweight(to_tsvector('english', coalesce(source_name, '')),  'C') ||
    setweight(to_tsvector('english', coalesce(body_text, '')),    'D')
  ) stored;

create index if not exists items_search_tsv_idx on items using gin (search_tsv);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Concept layer  (Phase 1 — "concept nodes" / "prevalence")
-- ────────────────────────────────────────────────────────────────────────────
-- One row per canonical term. match_key is the dedup key (lowercased +
-- conservatively singularized); term is the human-facing display form; slug is
-- for /concept/[slug]. block_count is denormalized prevalence (how many blocks
-- mention the concept) — refreshed by recompute_concept_stats().

create table if not exists concepts (
  id          uuid primary key default gen_random_uuid(),
  match_key   text unique not null,
  term        text not null,
  slug        text unique not null,
  ngram       smallint not null default 1,
  block_count int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists concepts_block_count_idx on concepts (block_count desc);

-- block ↔ concept, weighted. tf = term frequency within the block. The tf-idf
-- weight used for ranking and related-block edges is computed ON READ from
-- concepts.block_count (see related_blocks below), so nothing stored here goes
-- stale as the corpus grows.
create table if not exists block_concepts (
  block_id   uuid not null references items(id)    on delete cascade,
  concept_id uuid not null references concepts(id) on delete cascade,
  count      int  not null default 1,
  tf         real not null default 0,
  primary key (block_id, concept_id)
);

create index if not exists block_concepts_concept_idx on block_concepts (concept_id);
create index if not exists block_concepts_block_idx   on block_concepts (block_id);

-- Marks which blocks have already been through extraction, so the backfill
-- action can page through only the un-indexed ones. Mirrors how
-- scrapeMissingMetadata pages over items where image_url IS NULL.
alter table items
  add column if not exists concepts_indexed_at timestamptz;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RLS — public select; service role bypasses RLS for writes (matches 0001)
-- ────────────────────────────────────────────────────────────────────────────

alter table concepts       enable row level security;
alter table block_concepts enable row level security;

drop policy if exists "concepts are public" on concepts;
create policy "concepts are public" on concepts for select using (true);

drop policy if exists "block_concepts are public" on block_concepts;
create policy "block_concepts are public" on block_concepts for select using (true);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. RPCs (functions callable from the app via supabase.rpc(...))
-- ────────────────────────────────────────────────────────────────────────────

-- Phase 0: ranked full-text block search. websearch_to_tsquery parses user
-- input safely (handles quotes, OR, -exclusions), so no manual sanitization is
-- needed on the caller side.
create or replace function search_blocks(q text, lim int default 100)
returns setof items
language sql
stable
as $$
  select i.*
  from items i
  where i.search_tsv @@ websearch_to_tsquery('english', q)
  order by ts_rank(i.search_tsv, websearch_to_tsquery('english', q)) desc,
           i.created_at desc
  limit lim;
$$;

-- Note: concept prevalence (concepts.block_count) is maintained by the app in
-- lib/concepts.ts (per-row updates), not by a set-based SQL function — Supabase
-- runs in "safe update" mode, which rejects an UPDATE without a WHERE clause.

-- Phase 4: related blocks by shared-concept TF-IDF overlap. idf = ln(total/df),
-- so a rare shared concept ("graphiti") outweighs a common one ("design").
-- Concepts above the max-df cap (too common to be meaningful) are skipped,
-- which also keeps this from going quadratic. Score for a candidate block is
-- the dot product of the two blocks' concept vectors:  Σ (tf_a·idf)(tf_b·idf).
create or replace function related_blocks(
  p_block_id  uuid,
  p_limit     int  default 8,
  p_min_score real default 0.0
)
returns table (other_id uuid, score real)
language sql
stable
as $$
  with total as (
    select greatest(count(*), 1)::real as n from items
  ),
  mine as (  -- this block's concepts, each with its idf weight
    select bc.concept_id,
           bc.tf,
           ln((select n from total) / greatest(c.block_count, 1)) as idf
    from block_concepts bc
    join concepts c on c.id = bc.concept_id
    where bc.block_id = p_block_id
      and c.block_count <= (select n from total) * 0.4   -- max-df cap
  )
  select bc.block_id as other_id,
         sum((mine.tf * mine.idf) * (bc.tf * mine.idf))::real as score
  from mine
  join block_concepts bc on bc.concept_id = mine.concept_id
  where bc.block_id <> p_block_id
  group by bc.block_id
  having sum((mine.tf * mine.idf) * (bc.tf * mine.idf)) > p_min_score
  order by score desc
  limit p_limit;
$$;

-- Read RPCs must be callable by the roles PostgREST uses for public requests.
grant execute on function search_blocks(text, int)            to anon, authenticated;
grant execute on function related_blocks(uuid, int, real)     to anon, authenticated;

commit;
