-- svemir - migration 0013: channel concept pairs (the Garden's roots)
--
-- One RPC: channel_concept_pairs(). For every pair of channels that share at
-- least `min_shared` concepts, it returns a TF-IDF-weighted strength plus the
-- top shared terms. The Garden draws these pairs as root curves under the
-- soil, so the RPC is the entire data source for that feature.
--
-- Weighting mirrors related_blocks (0006), lifted from blocks to channels:
-- per (channel, concept) the tf values of the channel's blocks are summed,
-- idf = ln(total blocks / concept block_count), concepts above the 40% max-df
-- cap are skipped (too common to be meaningful), and a pair's weight is
-- sum(least(tf_a, tf_b) * idf^2) over the concepts both channels mention.
-- least() means a term only counts as much as the WEAKER side actually uses
-- it, so one obsessed channel cannot inflate every pairing.
--
-- MUST stay SECURITY INVOKER (the default, stated explicitly below): the
-- function reads `connections`, and anon's RLS on connections/channels
-- (migration 0012) is what hides private channels. A SECURITY DEFINER version
-- would run as the owner and leak private channels into the public garden.
-- Private-only blocks additionally have no block_concepts rows by design
-- (concept-row scrubbing), so no private term can enter the sums either way.
--
-- Additive and idempotent (CREATE OR REPLACE). Run in the Supabase SQL editor.
--
-- Parser caveat: the `[1:per_pair_terms]` array slice below uses a parameter
-- as a bound. If your Postgres version rejects it, replace both slices with a
-- fixed `[1:5]` and drop the per_pair_terms parameter.

begin;

create or replace function channel_concept_pairs(
  min_shared     int default 1,
  per_pair_terms int default 5
)
returns table (
  channel_a    uuid,
  channel_b    uuid,
  weight       real,
  shared_count int,
  top_terms    text[],
  top_slugs    text[]
)
language sql
stable
security invoker
set search_path = public
as $$
  with total as (
    select greatest(count(*), 1)::real as n from items
  ),
  channel_concepts as (
    -- per (channel, concept): summed tf across the channel's blocks + idf.
    -- Term/slug ride along so the pair query below can name its top terms.
    select cn.channel_id,
           bc.concept_id,
           c.term,
           c.slug,
           sum(bc.tf)::real as tf_sum,
           ln((select n from total) / greatest(c.block_count, 1))::real as idf
    from connections cn
    join block_concepts bc on bc.block_id = cn.block_id
    join concepts c        on c.id = bc.concept_id
    where c.block_count <= (select n from total) * 0.4   -- max-df cap
    group by cn.channel_id, bc.concept_id, c.term, c.slug, c.block_count
  ),
  pair_terms as (
    -- each shared concept's contribution to a channel pair (a < b, so every
    -- unordered pair appears exactly once)
    select a.channel_id as channel_a,
           a.concept_id,
           b.channel_id as channel_b,
           a.term,
           a.slug,
           (least(a.tf_sum, b.tf_sum) * a.idf * a.idf)::real as contribution
    from channel_concepts a
    join channel_concepts b
      on b.concept_id = a.concept_id
     and a.channel_id < b.channel_id
  )
  select pt.channel_a,
         pt.channel_b,
         sum(pt.contribution)::real as weight,
         count(*)::int              as shared_count,
         (array_agg(pt.term order by pt.contribution desc))[1:per_pair_terms] as top_terms,
         (array_agg(pt.slug order by pt.contribution desc))[1:per_pair_terms] as top_slugs
  from pair_terms pt
  group by pt.channel_a, pt.channel_b
  having count(*) >= min_shared
  order by weight desc
  limit 600;
$$;

-- Read RPCs must be callable by the roles PostgREST uses for public requests.
grant execute on function channel_concept_pairs(int, int) to anon, authenticated;

commit;

-- PostgREST caches the schema; without this, calls to the new function can
-- 404 until it refreshes on its own (matches 0007/0008/0012).
notify pgrst, 'reload schema';

-- Smoke test (run by hand after applying; needs at least one private channel):
--
--   set role anon;
--   select * from channel_concept_pairs(1, 5) limit 5;
--   -- expected: rows only between PUBLIC channels; no private channel id may
--   -- appear in channel_a/channel_b. Verify against:
--   reset role;
--   select id, title from channels where is_private;
