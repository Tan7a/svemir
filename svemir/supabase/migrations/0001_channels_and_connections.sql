-- svemir — schema migration: tags → channels
--
-- This migration converts the existing tags-based model into the are.na-shaped
-- channels-and-connections model.
--
-- Safe to re-run (uses IF NOT EXISTS / ON CONFLICT throughout).
-- Run this in the Supabase SQL editor against the project that holds your
-- 1156 items. BACK UP THE PROJECT FIRST.
--
-- After running this, run 0002_verify.sql to confirm counts match.
-- Only after that, run 0003_drop_old_tags.sql to delete tags & item_tags.

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. New tables
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists channels (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  title       text not null,
  description text,
  cover_url   text,
  parent_id   uuid references channels(id) on delete set null,
  created_at  timestamptz not null default now()
);

create unique index if not exists channels_lower_title_idx
  on channels (lower(title));

create table if not exists connections (
  block_id     uuid not null references items(id)    on delete cascade,
  channel_id   uuid not null references channels(id) on delete cascade,
  position     int  not null default 0,
  connected_at timestamptz not null default now(),
  primary key (block_id, channel_id)
);

create index if not exists connections_channel_idx
  on connections (channel_id, position);

create index if not exists connections_block_idx
  on connections (block_id);

-- block ↔ block manual connections (the curatorial gesture for the graph)
create table if not exists block_connections (
  a_id       uuid not null references items(id) on delete cascade,
  b_id       uuid not null references items(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (a_id, b_id),
  check (a_id < b_id)  -- canonical ordering, prevents duplicate edges
);

-- personal access tokens for the Chrome extension
create table if not exists api_tokens (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text unique not null,  -- sha256(token), never plaintext
  name         text not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. items: add kind column; make url nullable (for text blocks)
-- ────────────────────────────────────────────────────────────────────────────

alter table items
  add column if not exists kind text not null default 'link';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'items_kind_check' and conrelid = 'items'::regclass
  ) then
    alter table items add constraint items_kind_check
      check (kind in ('link', 'image', 'text'));
  end if;
end$$;

alter table items alter column url drop not null;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Migrate tags → channels (preserve UUIDs; idempotent)
-- ────────────────────────────────────────────────────────────────────────────

insert into channels (id, slug, title, created_at)
select
  t.id,
  coalesce(
    nullif(t.slug, ''),
    lower(regexp_replace(t.name, '[^a-zA-Z0-9]+', '-', 'g'))
  ),
  t.name,
  t.created_at
from tags t
on conflict (id) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Migrate item_tags → connections
--    position assigns each block within a channel by created_at (newest = 0)
-- ────────────────────────────────────────────────────────────────────────────

insert into connections (block_id, channel_id, position, connected_at)
select
  it.item_id,
  it.tag_id,  -- tag.id == channel.id by step 3
  (row_number() over (
     partition by it.tag_id
     order by i.created_at desc, i.id
  ) - 1)::int,
  coalesce(i.created_at, now())
from item_tags it
join items i on i.id = it.item_id
on conflict (block_id, channel_id) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. RLS — public select; service role bypasses RLS for writes
-- ────────────────────────────────────────────────────────────────────────────

alter table channels          enable row level security;
alter table connections       enable row level security;
alter table block_connections enable row level security;
alter table api_tokens        enable row level security;

drop policy if exists "channels are public" on channels;
create policy "channels are public" on channels
  for select using (true);

drop policy if exists "connections are public" on connections;
create policy "connections are public" on connections
  for select using (true);

drop policy if exists "block_connections are public" on block_connections;
create policy "block_connections are public" on block_connections
  for select using (true);

-- api_tokens: no public-select policy. Service role bypasses RLS.

commit;
