-- svemir — migration 0008: facet definitions + per-paper facet notes
--
-- Makes facet tags explainable:
--   • paper_facets.definition  — one short, canonical definition per facet
--     (what the tag means), shown when a tag is clicked.
--   • paper_facet_links.note    — a per-(paper, facet) summary of HOW that
--     specific paper relates to the facet ("what in this paper refers to it").
--
-- Both are agent-produced (no AI in the app) and written by scripts/apply-facets.mjs.
-- Public-readable already (the tables' select-using(true) policies from 0007 cover
-- new columns). Additive and idempotent. Run in the Supabase SQL editor.

begin;

alter table paper_facets      add column if not exists definition text;
alter table paper_facet_links add column if not exists note       text;

-- Reload PostgREST's schema cache so the new columns are queryable now.
notify pgrst, 'reload schema';

commit;
