-- 0010_guestbook_style.sql
--
-- Adds a per-note "paper style" to the guestbook. A visitor now picks how their
-- note looks (lined / grid / torn / taped) via the `< Style >` switcher in the
-- composer; the choice is saved here and rendered on the wall. Existing rows
-- default to 'lined', so nothing already on the wall changes.
--
-- Validation of the value against the known vocabulary still happens in the
-- `signGuestbook` server action (see app/guestbook/actions.ts); this column just
-- stores it. No RLS changes - the existing SELECT-only policy from 0009 already
-- covers the new column.

begin;

alter table guestbook_entries
  add column if not exists style text not null default 'lined';

commit;
