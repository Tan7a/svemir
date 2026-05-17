-- svemir — verification queries
--
-- Run AFTER 0001_channels_and_connections.sql, BEFORE 0003_drop_old_tags.sql.
-- All counts in the first row should match expectations:
--   old_tags == new_channels  (every tag became a channel)
--   old_item_tags == new_connections  (every link preserved)
--   items_without_channel == (number of items that had no tags before)
--
-- The second query lists items with no channel — sanity-check this is the
-- handful you intentionally left untagged.

select
  (select count(*) from tags)               as old_tags,
  (select count(*) from channels)           as new_channels,
  (select count(*) from item_tags)          as old_item_tags,
  (select count(*) from connections)        as new_connections,
  (select count(*) from items
     where id not in (select block_id from connections)) as items_without_channel;

-- Items that ended up with no channel — should match the count of items
-- that previously had no tags.
select id, title, url
from items
where id not in (select block_id from connections)
order by created_at desc
limit 50;

-- Spot-check: pick the most-used channel and confirm its block count matches
-- the most-used tag's count.
with old_top as (
  select tag_id, count(*) as n from item_tags group by tag_id order by n desc limit 1
),
new_top as (
  select channel_id, count(*) as n from connections group by channel_id order by n desc limit 1
)
select
  (select n from old_top) as old_top_tag_count,
  (select n from new_top) as new_top_channel_count;
