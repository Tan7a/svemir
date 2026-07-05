"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { VIEW_OPTIONS, type ViewKind } from "./FilterBar";

/**
 * Horizontal view switcher, centered in the TopBar. Channels / Blocks set the
 * ?view= param on the homepage; Graph / Research / Design are their own pages.
 * Rendered on EVERY page (the menu is always reachable, incl. inside a channel
 * or block). Blocks / Channels highlight only on home; off-home nothing in the
 * pair is active and clicking one navigates home with a fresh ?view=. Absolutely
 * centered so it stays mid-bar regardless of the left/right widths.
 */
export default function ViewNav() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const onHome = pathname === "/";
  const onGraph = pathname === "/graph";
  const onFacets = pathname === "/facets";
  const onDesignSystem = pathname === "/design-system";

  // Blocks / Channels only reflect state on home; elsewhere neither is active.
  const activeView: ViewKind | null = !onHome
    ? null
    : searchParams.get("view") === "channels"
      ? "channels"
      : "blocks";

  function setView(v: ViewKind) {
    // On home preserve order / q; from any other page start fresh.
    const sp = new URLSearchParams(onHome ? searchParams.toString() : "");
    sp.set("view", v);
    router.push(`/?${sp.toString()}`, { scroll: false });
  }

  return (
    <nav className="hidden items-center gap-6 text-sm md:flex">
      {VIEW_OPTIONS.map((opt) => {
        const active = activeView === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setView(opt.value)}
            className={
              active
                ? "text-neutral-100"
                : "text-neutral-400 hover:text-neutral-200"
            }
          >
            {opt.label}
          </button>
        );
      })}
      <Link
        href="/graph"
        className={
          onGraph
            ? "text-neutral-100"
            : "text-neutral-400 hover:text-neutral-100"
        }
      >
        Graph
      </Link>
      <Link
        href="/facets"
        className={
          onFacets
            ? "text-neutral-100"
            : "text-neutral-400 hover:text-neutral-100"
        }
      >
        Research
      </Link>
      <Link
        href="/design-system"
        className={
          onDesignSystem
            ? "text-neutral-100"
            : "text-neutral-400 hover:text-neutral-100"
        }
      >
        Design
      </Link>
    </nav>
  );
}
