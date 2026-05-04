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

export type Tag = {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  created_at: string;
};

export type ItemWithTags = Item & {
  tags: Tag[];
};
