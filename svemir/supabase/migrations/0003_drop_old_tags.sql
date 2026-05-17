-- svemir — final cleanup: drop old tags & item_tags tables
--
-- DO NOT RUN until 0002_verify.sql has confirmed counts match.
-- This is irreversible (UUIDs were preserved in channels.id, so the data
-- itself isn't lost, but the original junction is).
--
-- Wrap in a transaction so it's all-or-nothing.

begin;

drop table if exists item_tags;
drop table if exists tags;

commit;
