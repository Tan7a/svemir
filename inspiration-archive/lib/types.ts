export type Item = {
  id: string;
  url: string;
  title: string;
  description: string | null;
  image_url: string | null;
  source_name: string | null;
  source_handle: string | null;
  source_type: string;
  categories: string[];
  notes: string | null;
  created_at: string;
};

export type Channel = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  cover_image_url: string | null;
  created_at: string;
};

export type ChannelWithCount = Channel & { item_count: number };

export type ChannelMembership = {
  position: number;
  added_at: string;
};

export type ItemWithChannels = Item & {
  channels: Channel[];
};
