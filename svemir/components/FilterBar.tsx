// View / Order vocabulary, shared by the TopBar controls (ViewNav,
// OrderDropdown) and the homepage routes in app/page.tsx. Selection persists in
// URL params (?view=blocks&order=newest). This used to also render the
// three-column filter panel; that panel is gone — the controls now live in the
// TopBar — so this file is just the definitions.

export type ViewKind = "channels" | "blocks";
export type OrderKind =
  | "relevance"
  | "updated"
  | "newest"
  | "oldest"
  | "alphabetical"
  | "source"
  | "type"
  | "theme"
  | "vibes"
  | "connections"
  | "random";

export const VIEW_OPTIONS: { value: ViewKind; label: string }[] = [
  { value: "channels", label: "Channels" },
  { value: "blocks", label: "Blocks" },
];

export const ORDER_OPTIONS: { value: OrderKind; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "alphabetical", label: "Alphabetical" },
  { value: "type", label: "By type" },
  { value: "theme", label: "By theme" },
  { value: "source", label: "By source" },
  { value: "connections", label: "No. of connections" },
  { value: "vibes", label: "Vibes" },
  { value: "random", label: "Random" },
];

// Channels use their own vocabulary — "updated" = the channel whose newest
// block was saved most recently.
export const CHANNEL_ORDER_OPTIONS: { value: OrderKind; label: string }[] = [
  { value: "updated", label: "Recently updated" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "alphabetical", label: "Alphabetical" },
  { value: "connections", label: "No. of blocks" },
  { value: "random", label: "Random" },
];
