-- svemir - migration 0011: performance indexes + channel aggregation RPCs
--
-- The archive got slower as it grew. Two fixes here:
--
--   1. Indexes backing the orderings/joins the app actually runs: items by
--      created_at (newest/oldest sort), source_name ("By source" + filter),
--      title (A-Z sort), channels.parent_id (nested-channel self-join on
--      /channel/[slug]), block_connections.b_id (the or(a_id,b_id) lookup in
--      getBlockWithChannels), and a GIN index on items.categories (the
--      "By theme" contains() filter).
--
--   2. RPCs that aggregate in SQL instead of shipping every connection row to
--      Node: recent_channels / channel_stats (replacing the JS aggregation in
--      lib/channels.ts) and search_block_cards (same FTS as search_blocks but
--      returning only the card columns, not body_text + search_tsv).
--
-- Additive and idempotent (IF NOT EXISTS / CREATE OR REPLACE throughout).
-- Safe to re-run. Run this in the Supabase SQL editor.
--
-- After running, Supabase reloads the PostgREST schema cache automatically. If
-- the new functions don't show up, run:  notify pgrst, 'reload schema';

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Indexes
-- ────────────────────────────────────────────────────────────────────────────

create index if not exists items_created_at_idx       on items (created_at desc);
create index if not exists items_source_name_idx      on items (source_name);
create index if not exists items_title_idx            on items (title);
create index if not exists channels_parent_id_idx     on channels (parent_id);
create index if not exists block_connections_b_id_idx on block_connections (b_id);
create index if not exists items_categories_gin_idx   on items using gin (categories);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Channel aggregation RPCs
-- ────────────────────────────────────────────────────────────────────────────

-- Channels ordered by most-recent connection, with block counts. Replaces
-- recentChannels() in lib/channels.ts, which pulled every connections row of
-- every channel and counted in JS.
create or replace function recent_channels(lim int default 20)
returns table (
  id uuid,
  slug text,
  title text,
  block_count int,
  last_connected_at timestamptz
)
language sql
stable
as $$
  select c.id,
         c.slug,
         c.title,
         count(conn.block_id)::int  as block_count,
         max(conn.connected_at)     as last_connected_at
  from channels c
  left join connections conn on conn.channel_id = c.id
  group by c.id
  order by max(conn.connected_at) desc nulls last, c.title asc
  limit lim;
$$;

-- Per-channel block counts + the distinct source names of connected items.
-- Replaces channelStats() in lib/channels.ts, which pulled the source_name of
-- every connected item across all channels and aggregated in JS.
create or replace function channel_stats()
returns table (
  id uuid,
  title text,
  block_count int,
  source_names text[]
)
language sql
stable
as $$
  select c.id,
         c.title,
         count(conn.block_id)::int,
         coalesce(
           array_agg(distinct trim(i.source_name))
             filter (where i.source_name is not null and trim(i.source_name) <> ''),
           '{}'
         )
  from channels c
  left join connections conn on conn.channel_id = c.id
  left join items i on i.id = conn.block_id
  group by c.id;
$$;

-- Card-slim full-text search: same query shape as search_blocks (0006) but
-- returns only the columns the search grid renders, instead of setof items
-- (which drags body_text + search_tsv along for up to 100 rows). Explicit
-- casts keep the signature valid regardless of the base items column types.
create or replace function search_block_cards(q text, lim int default 100)
returns table (
  id uuid,
  url text,
  title text,
  description text,
  image_url text,
  source_name text,
  kind text,
  categories text[],
  created_at timestamptz,
  paper_authors text[],
  paper_year smallint
)
language sql
stable
as $$
  select i.id,
         i.url::text,
         i.title::text,
         i.description::text,
         i.image_url::text,
         i.source_name::text,
         i.kind::text,
         i.categories::text[],
         i.created_at::timestamptz,
         i.paper_authors::text[],
         i.paper_year::smallint
  from items i
  where i.search_tsv @@ websearch_to_tsquery('english', q)
  order by ts_rank(i.search_tsv, websearch_to_tsquery('english', q)) desc,
           i.created_at desc
  limit lim;
$$;

-- Read RPCs must be callable by the roles PostgREST uses for public requests.
grant execute on function recent_channels(int)          to anon, authenticated;
grant execute on function channel_stats()               to anon, authenticated;
grant execute on function search_block_cards(text, int) to anon, authenticated;

commit;
