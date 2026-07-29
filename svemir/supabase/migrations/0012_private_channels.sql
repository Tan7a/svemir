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
--
-- All read RPCs (search_blocks, related_blocks, recent_channels, channel_stats,
-- search_block_cards, connected_blocks) are SECURITY INVOKER, so these policies
-- flow through them automatically for anon callers.
--
-- Concept-term leakage (concepts / block_concepts stay select-using(true)) is
-- handled in app code: private-only blocks get their block_concepts rows
-- removed (see setChannelPrivacy in app/admin/actions.ts), so no term or count
-- derived from a private block is ever publicly visible.
--
-- Additive and idempotent. Run in the Supabase SQL editor.

begin;

alter table channels
  add column if not exists is_private boolean not null default false;

-- channels: hide private ones from anon.
drop policy if exists "channels are public" on channels;
create policy "channels are public" on channels
  for select using (not is_private);

-- connections: hide any row that points into a private channel, even when the
-- block itself is public elsewhere.
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
  for select using (
    not exists (
      select 1 from connections cn where cn.block_id = items.id
    )
    or exists (
      select 1
      from connections cn
      join channels c on c.id = cn.channel_id
      where cn.block_id = items.id and not c.is_private
    )
  );

-- block_connections: an edge is visible only when both endpoints are visible
-- blocks (same predicate as the items policy, applied to each endpoint).
drop policy if exists "block_connections are public" on block_connections;
create policy "block_connections are public" on block_connections
  for select using (
    (
      not exists (select 1 from connections cn where cn.block_id = a_id)
      or exists (
        select 1 from connections cn join channels c on c.id = cn.channel_id
        where cn.block_id = a_id and not c.is_private
      )
    )
    and
    (
      not exists (select 1 from connections cn where cn.block_id = b_id)
      or exists (
        select 1 from connections cn join channels c on c.id = cn.channel_id
        where cn.block_id = b_id and not c.is_private
      )
    )
  );

commit;
