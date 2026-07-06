"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { THEMES, type ThemeId, getTheme, setTheme } from "@/lib/themes";

type View = "root" | "theme" | "about";

/**
 * The svemir logomark. Left-click navigates home (unchanged); right-click opens
 * a classic product context menu - quick navigation, a theme switcher, copy
 * link, and an about blurb. Reuses the same dropdown affordance as the channel
 * "⋯" menu (click-outside + Escape to close).
 */
export default function BrandMark() {
  const router = useRouter();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [view, setView] = useState<View>("root");
  const [theme, setThemeState] = useState<ThemeId>("dark");
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  function close() {
    setMenu(null);
    setView("root");
    setCopied(false);
  }

  function openMenu(e: React.MouseEvent) {
    e.preventDefault();
    // Clamp so a near-edge click keeps the ~14rem menu on-screen.
    const x = Math.min(e.clientX, window.innerWidth - 240);
    const y = Math.min(e.clientY, window.innerHeight - 320);
    setThemeState(getTheme());
    setView("root");
    setMenu({ x: Math.max(8, x), y: Math.max(8, y) });
  }

  function go(href: string) {
    close();
    router.push(href);
  }

  function pickTheme(id: ThemeId) {
    setTheme(id);
    setThemeState(id);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function replayIntro() {
    close();
    window.dispatchEvent(new Event("svemir:play-intro"));
  }

  return (
    <div ref={ref} className="flex items-center">
      <Link
        href="/"
        aria-label="svemir home"
        className="flex items-center"
        onContextMenu={openMenu}
      >
        {/* Inline so the mark inherits the theme's foreground via currentColor
            (text-neutral-100 flips to near-black in the light themes). */}
        <svg
          viewBox="0 0 320 100"
          className="h-auto w-10 text-neutral-100"
          fill="currentColor"
          aria-hidden
        >
          <ellipse cx="160" cy="50" rx="160" ry="50" />
        </svg>
      </Link>

      {menu && (
        <div
          role="menu"
          className="glass-panel fixed z-50 w-60 overflow-hidden rounded-xl border border-neutral-800 p-1.5 text-sm"
          style={{ left: menu.x, top: menu.y }}
        >
          {view === "root" && (
            <>
              <MenuItem label="Open homepage" onClick={() => go("/")} />
              <MenuItem label="Open graph" onClick={() => go("/graph")} />
              <MenuItem
                label="Add block"
                onClick={() => {
                  close();
                  // The floating + composer is the single add surface now;
                  // it enforces auth (opens sign-in when signed out).
                  window.dispatchEvent(new Event("svemir:open-composer"));
                }}
              />
              <Separator />
              <MenuItem
                label="Theme"
                trailing="▸"
                onClick={() => setView("theme")}
              />
              <Separator />
              <MenuItem
                label={copied ? "Copied ✓" : "Copy link"}
                onClick={copyLink}
              />
              <MenuItem label="Replay intro" onClick={replayIntro} />
              <MenuItem
                label="About svemir"
                trailing="▸"
                onClick={() => setView("about")}
              />
            </>
          )}

          {view === "theme" && (
            <>
              <MenuItem label="← Back" onClick={() => setView("root")} />
              <Separator />
              {THEMES.map((t) => (
                <MenuItem
                  key={t.id}
                  label={t.label}
                  trailing={theme === t.id ? "●" : ""}
                  onClick={() => pickTheme(t.id)}
                />
              ))}
            </>
          )}

          {view === "about" && (
            <>
              <MenuItem label="← Back" onClick={() => setView("root")} />
              <Separator />
              <div className="px-3 py-2 text-xs leading-relaxed text-neutral-400">
                <span className="text-neutral-200">svemir</span> is your personal
                universe of references. Blocks, channels, and a knowledge graph.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Separator() {
  return <div className="my-1 border-t border-neutral-800" />;
}

function MenuItem({
  label,
  trailing,
  onClick,
}: {
  label: string;
  trailing?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-neutral-200 transition-colors hover:bg-neutral-900/60"
    >
      <span className="flex-1">{label}</span>
      {trailing ? (
        <span aria-hidden className="text-xs text-neutral-500">
          {trailing}
        </span>
      ) : null}
    </button>
  );
}
