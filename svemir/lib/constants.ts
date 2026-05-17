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
 * Slug a free-form channel title into a URL-safe identifier.
 * Matches the SQL-side generation in 0001_channels_and_connections.sql.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
