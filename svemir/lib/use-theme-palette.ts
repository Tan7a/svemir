"use client";

import { useEffect, useState } from "react";

/**
 * Reactive theme palette for the canvas views (KnowledgeGraph map + IdeaGarden).
 * Those draw with imperative colour strings rather than Tailwind tokens, so they
 * can't ride the CSS-var ramp automatically - this hook resolves the current
 * theme into ready-to-use colour strings and re-reads them when `data-theme`
 * changes (the BrandMark theme switcher flips that attribute).
 *
 * inkRGB   - foreground ("r,g,b"): links, labels, plant text.
 * haloRGB  - background ("r,g,b"): the halo stroked behind labels for legibility.
 */
export type ThemePalette = {
  isDark: boolean;
  /** Solid background colour (e.g. for the graph canvas). */
  bg: string;
  /** "r,g,b" triples so callers can add their own alpha. */
  inkRGB: string;
  haloRGB: string;
};

const DEFAULT: ThemePalette = {
  isDark: true,
  bg: "#0a0a0a",
  inkRGB: "255,255,255",
  haloRGB: "10,10,10",
};

function computePalette(): ThemePalette {
  if (typeof document === "undefined") return DEFAULT;
  const isDark = (document.documentElement.dataset.theme || "dark") === "dark";
  const bg =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--background")
      .trim() || (isDark ? "#0a0a0a" : "#ffffff");
  return {
    isDark,
    bg,
    // Dark theme: light ink on a dark halo. Light themes: dark ink on a light halo.
    inkRGB: isDark ? "255,255,255" : "23,23,23",
    haloRGB: isDark ? "10,10,10" : "255,255,255",
  };
}

export function useThemePalette(): ThemePalette {
  // Start from the SSR-safe default (dark) and read the real theme after mount,
  // so hydration matches; a MutationObserver keeps it live on theme switches.
  const [palette, setPalette] = useState<ThemePalette>(DEFAULT);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPalette(computePalette());
    const obs = new MutationObserver(() => setPalette(computePalette()));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => obs.disconnect();
  }, []);
  return palette;
}
