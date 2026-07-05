/**
 * Shared guestbook vocabulary - the fixed palette of accent colours and
 * stickers a visitor can personalise their note with, plus the "paper" look
 * helpers. Kept in one place so the form (GuestbookForm) and the rendered cards
 * (guestbook page / admin) never drift apart.
 *
 * Notes render on a cream `.paper-note` surface (see globals.css); the chosen
 * colour is a small accent (a coloured dot + the name underline), not the whole
 * surface - matching the sticky-note inspiration.
 *
 * NOTE: the class strings are full literals on purpose so Tailwind's source
 * scan picks them up - do not build them dynamically.
 */

export type GuestbookColor = {
  key: string;
  /** Solid swatch for the picker button. */
  swatch: string;
  /** Accent used on the paper note (dot + name underline). */
  dot: string;
  /** Whole-card paper tint (hex) - the chosen colour fills the note. */
  paper: string;
};

export const GUESTBOOK_COLORS: GuestbookColor[] = [
  { key: "amber", swatch: "bg-amber-400", dot: "bg-amber-400", paper: "#f8e39c" },
  { key: "rose", swatch: "bg-rose-400", dot: "bg-rose-400", paper: "#f7ccd5" },
  { key: "violet", swatch: "bg-violet-400", dot: "bg-violet-400", paper: "#dbd4fb" },
  { key: "sky", swatch: "bg-sky-400", dot: "bg-sky-400", paper: "#bfe4fb" },
  { key: "emerald", swatch: "bg-emerald-400", dot: "bg-emerald-400", paper: "#b3edcf" },
  { key: "stone", swatch: "bg-stone-500", dot: "bg-stone-500", paper: "#e9e6e0" },
];

export const GUESTBOOK_STICKERS = [
  "✨", "🌟", "💜", "🌈", "☕️", "📚", "🖊️", "🎨", "🌸", "👋", "🔥", "🙌",
];

export const DEFAULT_COLOR = "stone";

/** Small rotations so a wall of notes feels hand-pinned, not gridded. */
export const PAPER_ROTATIONS = [
  "-rotate-2",
  "rotate-1",
  "-rotate-1",
  "rotate-2",
  "rotate-0",
];

/** Deterministic rotation for a card by index (stable across renders). */
export function rotationFor(index: number): string {
  return PAPER_ROTATIONS[index % PAPER_ROTATIONS.length];
}

/** Accent dot colour for a stored colour key, falling back to stone. */
export function accentDot(colorKey: string | null | undefined): string {
  const found = GUESTBOOK_COLORS.find((c) => c.key === colorKey);
  return (found ?? GUESTBOOK_COLORS[GUESTBOOK_COLORS.length - 1]).dot;
}

/** Whole-card paper tint (hex) for a stored colour key, falling back to stone. */
export function cardBg(colorKey: string | null | undefined): string {
  const found = GUESTBOOK_COLORS.find((c) => c.key === colorKey);
  return (found ?? GUESTBOOK_COLORS[GUESTBOOK_COLORS.length - 1]).paper;
}
