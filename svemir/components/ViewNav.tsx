"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { VIEW_OPTIONS, type ViewKind } from "./FilterBar";

/**
 * Horizontal view switcher, centered in the TopBar. Channels / Blocks set the
 * ?view= param on the homepage; Graph is its own page. Only rendered on "/" —
 * the view vocabulary is meaningless elsewhere. Absolutely centered so it stays
 * mid-bar regardless of the left (logo + search) and right (order + add) widths.
 */
export default function ViewNav() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Visible on the home view, the graph page, the concepts page, and the facets
  // index — all "the main view".
  if (
    pathname !== "/" &&
    pathname !== "/graph" &&
    pathname !== "/concepts" &&
    pathname !== "/facets" &&
    pathname !== "/design-system"
  )
    return null;
  const onGraph = pathname === "/graph";
  const onConcepts = pathname === "/concepts";
  const onFacets = pathname === "/facets";
  const onDesignSystem = pathname === "/design-system";

  const activeView: ViewKind | null =
    onGraph || onConcepts || onFacets || onDesignSystem
      ? null
      : searchParams.get("view") === "channels"
        ? "channels"
        : "blocks";

  function setView(v: ViewKind) {
    // From the graph page start fresh; on home preserve order / q.
    const sp = new URLSearchParams(onGraph ? "" : searchParams.toString());
    sp.set("view", v);
    router.push(`/?${sp.toString()}`, { scroll: false });
  }

  return (
    <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-6 text-sm min-[900px]:flex">
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
