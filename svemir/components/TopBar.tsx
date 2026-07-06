import { Suspense } from "react";
import Link from "next/link";
import TopBarSearch from "./TopBarSearch";
import ViewNav from "./ViewNav";
import MobileNav from "./MobileNav";
import OrderDropdown from "./OrderDropdown";
import ResearchOrderDropdown from "./ResearchOrderDropdown";
import BrandMark from "./BrandMark";
import ProfileCorner from "./ProfileCorner";

/**
 * Persistent top bar across every page of svemir. Brand mark on the left,
 * primary nav (Graph, +Add) on the right.
 */
export default function TopBar() {
  // Opaque, NOT backdrop-blurred: a backdrop-filter here would create a
  // "backdrop root" that traps every menu rendered inside the header (sort,
  // mobile nav, brand), making their own glass sample differently from the
  // floating + menu. Keeping the header a plain opaque bar lets all menus
  // frost the page identically.
  return (
    <header className="sticky top-0 z-30 grid h-12 grid-cols-[1fr_auto_1fr] items-center gap-4 bg-background px-5 sm:px-8">
      <div className="flex min-w-0 items-center gap-5">
        <BrandMark />
        <Suspense
          fallback={<div className="hidden h-6 w-56 md:block" aria-hidden />}
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

      <nav className="flex items-center justify-end gap-0 text-sm">
        {/* Quiet Guestbook link, sitting next to the sort control. */}
        <Link
          href="/guestbook"
          className="rounded-xl px-2.5 py-1 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
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
        {/* Profile avatar (replaces the old Add button); hovering it peels the
            page corner to the portfolio. Adding content now lives in the
            owner-only floating + (bottom-right). */}
        <ProfileCorner />
        {/* Hamburger - only rendered below 900px (see MobileNav). */}
        <Suspense fallback={null}>
          <MobileNav />
        </Suspense>
      </nav>
    </header>
  );
}
