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
  /** Accent used on the paper note (the small dot in the admin list). */
  dot: string;
  /** Whole-card paper tint (hex) - the chosen colour fills the note. */
  paper: string;
};

// Warm, earthy, muted "paper" tints - desaturated so the wall reads calm and
// on-brand (never candy-bright). Keys are unchanged from the original palette so
// notes saved with the old pastel hexes keep tinting - only the hex changes.
// The picker swatches read the `paper` hex directly (inline), so no Tailwind
// swatch class is needed.
export const GUESTBOOK_COLORS: GuestbookColor[] = [
  { key: "amber", dot: "bg-amber-400", paper: "#ecdcae" },
  { key: "rose", dot: "bg-rose-400", paper: "#e6cccc" },
  { key: "violet", dot: "bg-violet-400", paper: "#d8cfda" },
  { key: "sky", dot: "bg-sky-400", paper: "#c7d4d8" },
  { key: "emerald", dot: "bg-emerald-400", paper: "#ccd6bf" },
  { key: "stone", dot: "bg-stone-500", paper: "#e5ded1" },
];

export const GUESTBOOK_STICKERS = [
  "✨", "🌟", "💜", "🌈", "☕️", "📚", "🖊️", "🎨", "🌸", "👋", "🔥", "🙌",
];

export const DEFAULT_COLOR = "stone";

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

/**
 * The paper "look" a visitor can choose for their note, cycled through the
 * `< Style >` switcher. Each maps to a modifier class layered on `.paper-note`
 * (see globals.css). `className` strings are full literals on purpose so
 * Tailwind's / the CSS bundle's scan keeps them - do not build them dynamically.
 */
export type GuestbookStyle = {
  key: string;
  /** Human label shown in the switcher. */
  label: string;
  /** Modifier class layered on `.paper-note` ("" = the plain lined paper). */
  className: string;
};

export const GUESTBOOK_STYLES: GuestbookStyle[] = [
  { key: "lined", label: "Lined", className: "" },
  { key: "grid", label: "Grid", className: "paper-note--grid" },
  { key: "torn", label: "Torn", className: "paper-note--torn" },
  { key: "tape", label: "Taped", className: "paper-note--tape" },
];

export const DEFAULT_STYLE = "lined";

/** Modifier class for a stored style key, falling back to the plain lined paper. */
export function styleClass(styleKey: string | null | undefined): string {
  const found = GUESTBOOK_STYLES.find((s) => s.key === styleKey);
  return (found ?? GUESTBOOK_STYLES[0]).className;
}
