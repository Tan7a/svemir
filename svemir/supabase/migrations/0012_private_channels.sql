-- svemir - migration 0012: private channels
--
-- A channel can be marked private. Privacy is enforced HERE, at the RLS layer,
-- not in app code: the anon key (used by every public page and by anyone
-- hitting PostgREST directly) simply cannot see private channels, connections
-- into them, or blocks whose channels are all private. The service-role key
-- (admin server actions, bearer-token APIs, the extension) bypasses RLS and
-- keeps seeing everything - that is the owner's view.
--
-- Visibility semantics (Are.na-shaped):
--   channel   visible iff not is_private
--   connection visible iff its channel is visible
--   block     visible iff it has no connections at all, OR at least one
--             connection to a public channel. (A block in both a private and
--             a public channel stays public via the public one; its membership
--             in the private channel is hidden by the connections policy.)
--   block_connections edge visible iff both endpoint blocks are visible
--   paper_facet_links row visible iff its paper (an items row) is visible;
--             the `note` column carries content-bearing prose about the paper.
--
-- The block-visibility predicate lives in block_is_public(), a SECURITY
-- DEFINER function. This is load-bearing, not style: policy subqueries run
-- under the *caller's* RLS, so a plain `not exists (select 1 from
-- connections ...)` branch cannot see private connections for anon and would
-- classify a private-only block as "unconnected", i.e. public - the exact
-- inverse of the intent. The definer function checks connections/channels
-- with owner privileges, so the answer is true regardless of who asks.
--
-- All read RPCs (search_blocks, related_blocks, recent_channels, channel_stats,
-- search_block_cards, connected_blocks) are SECURITY INVOKER, so these policies
-- flow through them automatically for anon callers.
--
-- Concept-term leakage (concepts / block_concepts stay select-using(true)) is
-- handled in app code: private-only blocks get their block_concepts rows
-- removed, and concepts whose count drops to zero are deleted (see
-- setChannelPrivacy in app/admin/actions.ts and lib/concepts.ts), so no term
-- or count derived from a private block is ever publicly visible.
--
-- Additive and idempotent (drop-and-recreate). Run in the Supabase SQL editor;
-- safe to re-run over an earlier version of this file.

begin;

alter table channels
  add column if not exists is_private boolean not null default false;

-- The single source of truth for "is this block visible to the public?".
-- SECURITY DEFINER so the connections/channels lookups are NOT filtered by
-- the caller's RLS (see header). STABLE: same answer within one statement.
-- search_path is pinned so a malicious schema cannot shadow the tables.
create or replace function block_is_public(block uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    not exists (
      select 1 from connections cn where cn.block_id = block
    )
    or exists (
      select 1
      from connections cn
      join channels c on c.id = cn.channel_id
      where cn.block_id = block and not c.is_private
    );
$$;

-- Anon must be able to *call* the function (its body runs as the owner).
grant execute on function block_is_public(uuid) to anon, authenticated;

-- channels: hide private ones from anon.
drop policy if exists "channels are public" on channels;
create policy "channels are public" on channels
  for select using (not is_private);

-- connections: hide any row that points into a private channel, even when the
-- block itself is public elsewhere. (Self-contained: `channels` seen through
-- anon RLS already excludes private rows, and a missing row here fails closed.)
drop policy if exists "connections are public" on connections;
create policy "connections are public" on connections
  for select using (
    exists (
      select 1 from channels c
      where c.id = channel_id and not c.is_private
    )
  );

-- items: a block is public unless it is connected ONLY to private channels.
drop policy if exists "items are public" on items;
create policy "items are public" on items
  for select using (block_is_public(id));

-- block_connections: an edge is visible only when both endpoints are visible.
drop policy if exists "block_connections are public" on block_connections;
create policy "block_connections are public" on block_connections
  for select using (block_is_public(a_id) and block_is_public(b_id));

-- paper_facet_links: `note` is per-paper prose (how the paper relates to the
-- facet), so it must follow the paper's visibility instead of using(true)
-- from 0007. Non-destructive: rows are hidden, never deleted, so flipping a
-- channel back to public restores them untouched. paper_facets.paper_count
-- still counts private papers - a bare number, accepted.
drop policy if exists "paper_facet_links are public" on paper_facet_links;
create policy "paper_facet_links are public" on paper_facet_links
  for select using (block_is_public(paper_id));

commit;

-- PostgREST caches the schema; without this, selects on the new column can
-- 400 until it refreshes on its own (matches 0007/0008).
notify pgrst, 'reload schema';

-- Smoke test (run by hand after applying, with one block that sits ONLY in a
-- private channel and one block in both a private and a public channel):
--
--   set role anon;
--   select id, title from items where id = '<private-only block id>';  -- 0 rows
--   select id, title from items where id = '<mixed block id>';         -- 1 row
--   select count(*) from paper_facet_links
--     where paper_id = '<private-only block id>';                      -- 0
--   reset role;
