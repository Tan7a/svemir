// Mirror of svemir/lib/types.ts shapes the extension needs. Hand-synced.

export type Kind = "link" | "image" | "text";

export type ExtractedAsset = {
  url: string;
  title: string;
  description: string;
  image_url: string;
  source_name: string;
  kind: Kind;
  body_text?: string;
};

export type RecentChannel = {
  id: string;
  slug: string;
  title: string;
  block_count: number;
  last_connected_at: string | null;
};

export type Suggestion = {
  title: string;
  score: number;
  autoSelect: boolean;
};

export type Settings = {
  baseUrl: string;
  token: string;
};

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: "https://svemir.space",
  token: "",
};
