-- 0004_items_rls.sql
--
-- Lock down the `items` table. Migration 0001 enabled RLS on `channels`,
-- `connections`, `block_connections`, and `api_tokens` but did NOT touch
-- `items` (which predates that migration). Without RLS, the public anon
-- key can insert/update/delete rows directly via supabase-js from the
-- browser — bypassing the /admin Basic Auth gate entirely.
--
-- BEFORE RUNNING — audit current state in the SQL editor:
--
--   select relrowsecurity
--   from pg_class
--   where relname = 'items';
--
--   select polname, polcmd, polqual::text
--   from pg_policy
--   where polrelid = 'items'::regclass;
--
-- If `relrowsecurity` is already `true` AND only a select-only policy
-- exists, this migration is a no-op (the `drop policy if exists` + recreate
-- pattern is idempotent). If RLS is off, this turns it on. If there are
-- unexpected insert/update/delete policies, drop them by hand first.
--
-- AFTER RUNNING — verify writes are blocked from anon, allowed from
-- service-role. From the SQL editor with the anon role:
--
--   set role anon;
--   insert into items (title, kind) values ('rls-test', 'link');
--   -- expect: ERROR: new row violates row-level security policy
--   reset role;
--
-- The server uses the service-role key via supabaseAdmin, which bypasses
-- RLS for legitimate writes from server actions and the bearer-token API.

begin;

alter table items enable row level security;

drop policy if exists "items are public" on items;
create policy "items are public" on items
  for select using (true);

-- No insert/update/delete policy: anon is denied, service role bypasses.

commit;
