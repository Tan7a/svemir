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

export type BrandColor = {
  name: string;
  pantone: string;
  hex: string;
  /**
   * Map-only substitute colour, with its own name. The Map is deliberately a
   * cooler, deep-space read than the Garden, so the two greens are swapped for
   * blues there. Chosen at the same relative luminance as the green they
   * replace, so swapping them does not change how the depth fog reads.
   *
   * Note this means a green channel is green in the Garden and blue on the
   * Map. That divergence is intentional, not a drift between two palettes.
   */
  mapHex?: string;
  mapName?: string;
  /** A UI neutral: documented, but never used as a channel identity colour. */
  neutral?: boolean;
};

/**
 * The brand palette: eleven named colours with their Pantone references. Single
 * source of truth for channel identity (Garden pills and leaves, Map nodes) and
 * for the swatch set on /design-system.
 *
 * `neutral` marks the two greys. They are documented but excluded from the
 * channel rotation, so no channel reads as "uncoloured" beside the chromatic
 * ones, and Off White never becomes the brightest thing on the Map.
 *
 * Map nodes draw at full opacity so the hue lands true, and depth comes from
 * the scene fog rather than from tinting the colour. The only place the two
 * views differ is the deliberate green-to-blue swap described on `mapHex`.
 */
export const BRAND_PALETTE: BrandColor[] = [
  { name: 'Sunny Yellow',    pantone: '109 C',   hex: '#FFB500' },
  { name: 'Ocean Blue',      pantone: '2130',    hex: '#4E76D0' },
  { name: 'Sky Blue',        pantone: '283',     hex: '#8EBFE8' },
  { name: 'Forest Green',    pantone: '2427',    hex: '#01561D', mapHex: '#1A4E8F', mapName: 'Deep Blue' },
  { name: 'Emerald Green',   pantone: '7724',    hex: '#00936D', mapHex: '#0D8AAE', mapName: 'Teal Blue' },
  { name: 'Lavender Purple', pantone: '7671',    hex: '#4F467F' },
  { name: 'Grape Purple',    pantone: '2715',    hex: '#8885D2' },
  { name: 'Ruby Red',        pantone: '1645',    hex: '#FC6E48' },
  { name: 'Quartz Pink',     pantone: '3572',    hex: '#FF9BA5' },
  { name: 'Stone Gray',      pantone: '283',     hex: '#C6C6C6', neutral: true },
  { name: 'Off White',       pantone: '663 39%', hex: '#F3F2F5', neutral: true },
];

/** The chromatic colours, in order, that channels cycle through. */
export const CHANNEL_PALETTE: BrandColor[] = BRAND_PALETTE.filter(
  (c) => !c.neutral
);

/** Deterministic palette slot for an id (same hash scheme as colorForTag). */
function channelSwatch(id: string): BrandColor {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return CHANNEL_PALETTE[Math.abs(hash) % CHANNEL_PALETTE.length];
}

/** A channel's brand colour. Garden pills, leaves, and DOM chrome. */
export function channelColor(id: string): string {
  return channelSwatch(id).hex;
}

/** A channel's colour on the Map, where the greens are swapped for blues. */
export function channelMapColor(id: string): string {
  const c = channelSwatch(id);
  return c.mapHex ?? c.hex;
}

/**
 * Palette colours usable as TEXT on the dark page background.
 *
 * A colour that reads fine as a 6px dot can be unreadable as a word. Forest
 * Green and Lavender Purple sit at roughly 2.2:1 and 2.4:1 against the page,
 * well under the 4.5:1 minimum, so they are filtered out here rather than
 * hand-excluded, which keeps this honest if the palette ever changes.
 *
 * Tuned for the dark theme, which is the default. On a light theme the light
 * end of the palette would be the failing side instead.
 */
export const TEXT_PALETTE: BrandColor[] = CHANNEL_PALETTE.filter(
  (c) =>
    contrastRatio(relativeLuminance(c.hex), relativeLuminance('#0a0a0a')) >= 4.5
);

/** Deterministic text-safe colour for any stable string (concept terms). */
export function textPaletteColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return TEXT_PALETTE[Math.abs(hash) % TEXT_PALETTE.length].hex;
}

/** The two inks that may sit on a brand swatch: page ink, and Off White. */
const INK_DARK = '#0a0a0a';
const INK_LIGHT = '#F3F2F5';

/** WCAG relative luminance of a #rrggbb colour. */
function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two relative luminances. */
function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Minimum contrast the light ink must reach to be used. This is the WCAG AA
 * threshold for large text and UI components, deliberately preferred here over
 * the 4.5:1 body-text rule: light-on-colour is the intended look for the brand
 * swatches, and at 4.5:1 only the two darkest colours would ever qualify.
 * Colours where even 3:1 fails fall back to near-black, which on those
 * (Sunny Yellow, Sky Blue, Quartz Pink...) is comfortably above 4.5:1 anyway.
 */
const INK_LIGHT_MIN_CONTRAST = 3;

/**
 * Ink for text sitting on a solid swatch. Prefers the light ink and only drops
 * to near-black where light text would be genuinely hard to read.
 */
export function inkOn(hex: string): string {
  const L = relativeLuminance(hex);
  return contrastRatio(L, relativeLuminance(INK_LIGHT)) >=
    INK_LIGHT_MIN_CONTRAST
    ? INK_LIGHT
    : INK_DARK;
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
