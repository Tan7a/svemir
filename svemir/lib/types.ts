export type Item = {
  id: string;
  url: string | null;
  title: string;
  description: string | null;
  image_url: string | null;
  source_name: string | null;
  source_handle: string | null;
  source_type: string;
  categories: string[];
  notes: string | null;
  kind: "link" | "image" | "text";
  body_text: string | null;
  created_at: string;
};

export type Channel = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  parent_id: string | null;
  created_at: string;
};

export type ItemWithChannels = Item & {
  channels: Channel[];
  connected_blocks: Item[];
};

/** Lightweight channel reference for the topic tags shown on block cards. */
export type ChannelTag = { slug: string; title: string };

/** A block carrying the channels (topics) it belongs to, for the Blocks grid. */
export type BlockWithChannelTags = Item & { channels: ChannelTag[] };

/**
 * A channel paired with its first N blocks — used by the Channels view to
 * render the horizontal thumb strip.
 */
export type ChannelWithBlocks = Channel & {
  blocks: Item[];
  block_count: number;
};
