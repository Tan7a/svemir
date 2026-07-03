import { Suspense } from "react";
import Link from "next/link";
import TopBarSearch from "./TopBarSearch";
import ViewNav from "./ViewNav";
import MobileNav from "./MobileNav";
import OrderDropdown from "./OrderDropdown";
import ResearchOrderDropdown from "./ResearchOrderDropdown";
import BrandMark from "./BrandMark";
import AddButton from "./AddButton";

/**
 * Persistent top bar across every page of svemir. Brand mark on the left,
 * primary nav (Graph, +Add) on the right.
 */
export default function TopBar() {
  return (
    <header className="sticky top-0 z-30 grid h-12 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-neutral-800 bg-background/95 px-5 backdrop-blur">
      <div className="flex min-w-0 items-center gap-5">
        <BrandMark />
        <Suspense
          fallback={<div className="hidden h-6 w-56 lg:block" aria-hidden />}
        >
          <TopBarSearch />
        </Suspense>
      </div>

      {/* Center - the view switcher, viewport-centered via the symmetric 1fr
          side columns so it never shifts when the left/right widths change
          between pages. Collapses to the hamburger at md. */}
      <div className="flex justify-center">
        <Suspense fallback={null}>
          <ViewNav />
        </Suspense>
      </div>

      <nav className="flex items-center justify-end gap-2 text-sm">
        {/* Quiet Guestbook link, sitting next to the sort control. */}
        <Link
          href="/guestbook"
          className="rounded-xl px-2.5 py-1 text-neutral-400 transition-colors hover:bg-neutral-900 hover:text-neutral-100"
        >
          Guestbook
        </Link>
        <Suspense fallback={null}>
          <OrderDropdown />
        </Suspense>
        {/* Research page's sort - self-hides everywhere except /facets. */}
        <Suspense fallback={null}>
          <ResearchOrderDropdown />
        </Suspense>
        {/* Add is desktop/tablet-only - Tanja won't be saving from her phone. */}
        <span className="hidden md:inline-flex">
          <Suspense
            fallback={
              <span className="flex items-center gap-1.5 rounded-xl border border-neutral-700 px-2.5 py-1 text-xs text-neutral-200">
                Add <span className="text-neutral-400">+</span>
              </span>
            }
          >
            <AddButton />
          </Suspense>
        </span>
        {/* Hamburger - only rendered below 900px (see MobileNav). */}
        <Suspense fallback={null}>
          <MobileNav />
        </Suspense>
      </nav>
    </header>
  );
}
