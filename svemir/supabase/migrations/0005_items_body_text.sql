-- 0005_items_body_text.sql
--
-- Store the extracted readable text of a saved page so it can be re-read
-- without leaving svemir ("Reader" view, like are.na). The extension
-- populates this from the live DOM when the user saves; legacy blocks
-- keep `body_text = null`.
--
-- Nullable. No index — searches today are channel-based; full-text search
-- across body_text can be added later via tsvector if needed.

begin;

alter table items add column if not exists body_text text;

commit;
