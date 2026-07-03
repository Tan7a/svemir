/**
 * Theme registry + tiny localStorage-backed switcher. The actual palettes live
 * in `app/globals.css` under `html[data-theme="…"]`; here we just flip the
 * attribute and remember the choice. A no-flash script in `app/layout.tsx`
 * re-applies the saved theme before first paint.
 */

export type ThemeId = "dark" | "light-white" | "cream" | "funky";

export const THEMES: { id: ThemeId; label: string }[] = [
  { id: "dark", label: "Dark" },
  { id: "light-white", label: "Light white" },
  { id: "cream", label: "Cream" },
  { id: "funky", label: "Funky" },
];

export function getTheme(): ThemeId {
  if (typeof document === "undefined") return "dark";
  return (document.documentElement.dataset.theme as ThemeId) || "dark";
}

export function setTheme(id: ThemeId): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem("theme", id);
  } catch {
    /* storage unavailable - theme still applies for this session */
  }
}
