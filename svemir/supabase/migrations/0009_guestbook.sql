-- 0009_guestbook.sql
--
-- Public guestbook: anonymous visitors leave a short, personalised note
-- (name + message + a colour + an emoji sticker). Notes auto-publish; Tanja
-- can hide/delete unwanted ones from /admin/guestbook.
--
-- Security model (mirrors items in 0004):
--   * RLS on, with a SELECT-only policy exposing just the *visible* rows.
--   * NO insert/update/delete policy → the public anon key cannot write.
--     All writes go through the `signGuestbook` server action using the
--     service-role key (supabaseAdmin), which bypasses RLS and does the
--     validation + rate-limiting server-side. `ip_hash` is only a coarse
--     salted hash used for rate-limiting; the public page never selects it.
--
-- AFTER RUNNING — verify anon cannot write:
--
--   set role anon;
--   insert into guestbook_entries (name, message) values ('x', 'y');
--   -- expect: ERROR: new row violates row-level security policy
--   reset role;

begin;

create table if not exists guestbook_entries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  message text not null,
  color text not null default 'neutral',
  sticker text,
  ip_hash text,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

alter table guestbook_entries enable row level security;

drop policy if exists "guestbook visible entries are public" on guestbook_entries;
create policy "guestbook visible entries are public" on guestbook_entries
  for select using (hidden = false);

-- No insert/update/delete policy: anon is denied, service role bypasses.

-- Newest-first reads.
create index if not exists guestbook_entries_created_at_idx
  on guestbook_entries (created_at desc);

commit;
