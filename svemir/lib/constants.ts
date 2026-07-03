export const CATEGORIES = [
  'Technology',
  'Design',
  'AI',
  'Culture',
  'Engineering',
  'Social Media',
  'Business',
  'Art',
] as const;

export const SOURCE_TYPES = [
  'website',
  'x',
  'github',
  'threads',
  'instagram',
  'youtube',
  'dribbble',
] as const;

export type Category = (typeof CATEGORIES)[number];
export type SourceType = (typeof SOURCE_TYPES)[number];

export const CATEGORY_PILL_CLASSES: Record<string, string> = {
  Technology: 'bg-cyan-200 text-cyan-900',
  Design: 'bg-lime-200 text-lime-900',
  AI: 'bg-violet-200 text-violet-900',
  Culture: 'bg-amber-200 text-amber-900',
  Engineering: 'bg-fuchsia-200 text-fuchsia-900',
  'Social Media': 'bg-sky-200 text-sky-900',
  Business: 'bg-stone-200 text-stone-900',
  Art: 'bg-rose-200 text-rose-900',
};

export const SOURCE_TYPE_LETTER: Record<string, string> = {
  website: '○',
  x: 'X',
  github: 'G',
  threads: 'T',
  instagram: 'I',
  youtube: 'Y',
  dribbble: 'D',
};

export const DEFAULT_TAGS = [
  'typography',
  'ui',
  'animation',
  'ai',
  'tools',
  'writing',
  'illustration',
  'product',
  'data-viz',
  'branding',
] as const;

export const TAG_COLOR_PALETTE: { bg: string; text: string }[] = [
  { bg: 'bg-emerald-100', text: 'text-emerald-800' },
  { bg: 'bg-orange-100', text: 'text-orange-800' },
  { bg: 'bg-indigo-100', text: 'text-indigo-800' },
  { bg: 'bg-pink-100', text: 'text-pink-800' },
  { bg: 'bg-teal-100', text: 'text-teal-800' },
  { bg: 'bg-yellow-100', text: 'text-yellow-800' },
  { bg: 'bg-purple-100', text: 'text-purple-800' },
  { bg: 'bg-blue-100', text: 'text-blue-800' },
];

export function colorForTag(id: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return TAG_COLOR_PALETTE[Math.abs(hash) % TAG_COLOR_PALETTE.length];
}

/**
 * Curated raw-hex palette for the knowledge graph canvas (where Tailwind classes
 * can't reach). Muted-but-distinct tones tuned to read well on a near-black
 * background - each channel gets one stable colour so its cluster is legible at a
 * glance, Obsidian-style, instead of a per-id rainbow.
 */
export const GRAPH_CHANNEL_PALETTE = [
  "#7aa2f7", // blue
  "#7dcfff", // cyan
  "#9ece6a", // green
  "#e0af68", // amber
  "#f7768e", // rose
  "#bb9af7", // purple
  "#2ac3de", // teal
  "#ff9e64", // orange
  "#73daca", // mint
  "#d291e4", // magenta
  "#e5c07b", // gold
  "#c0caf5", // lavender
] as const;

/** Deterministic graph colour for a channel id (same hash scheme as colorForTag). */
export function channelColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return GRAPH_CHANNEL_PALETTE[Math.abs(hash) % GRAPH_CHANNEL_PALETTE.length];
}

/**
 * Deterministic hue (0-359) from any id string. Same id → same hue every time,
 * so a concept/channel keeps its colour across renders. Shared by the knowledge
 * graph (concept colours) and the idea-garden (per-channel plant tint).
 */
export function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

/**
 * Slug a free-form channel title into a URL-safe identifier.
 * Matches the SQL-side generation in 0001_channels_and_connections.sql.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The five paper-facet dimensions, in display order, each with a human label,
 * Tailwind classes for its tag, and a raw hex (for the graph canvas). Kept in
 * sync with the CHECK constraint on paper_facets.dimension (0007). Shared by the
 * facet tags, the facet panel, the facets index, and the Research graph.
 */
export const FACET_DIMENSIONS = [
  { key: 'ai_technique',    label: 'AI technique',     text: 'text-cyan-300',    border: 'border-cyan-500/40',    hex: '#7dcfff' },
  { key: 'ux_effect',       label: 'UX effect',        text: 'text-emerald-300', border: 'border-emerald-500/40', hex: '#9ece6a' },
  { key: 'challenge',       label: 'Challenge',        text: 'text-amber-300',   border: 'border-amber-500/40',   hex: '#e0af68' },
  { key: 'metric',          label: 'Metric',           text: 'text-violet-300',  border: 'border-violet-500/40',  hex: '#bb9af7' },
  { key: 'ethical_concern', label: 'Ethical concern',  text: 'text-rose-300',    border: 'border-rose-500/40',    hex: '#f7768e' },
] as const;

export type FacetDimension = (typeof FACET_DIMENSIONS)[number]['key'];

export const FACET_DIMENSION_BY_KEY: Record<
  string,
  (typeof FACET_DIMENSIONS)[number]
> = Object.fromEntries(FACET_DIMENSIONS.map((d) => [d.key, d]));

/** Curated graph colour for a facet dimension (parallels channelColor). */
export function facetColor(dimension: string): string {
  return FACET_DIMENSION_BY_KEY[dimension]?.hex ?? '#c0caf5';
}
