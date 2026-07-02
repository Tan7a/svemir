import { Suspense } from "react";
import TopBarSearch from "./TopBarSearch";
import ViewNav from "./ViewNav";
import OrderDropdown from "./OrderDropdown";
import BrandMark from "./BrandMark";
import AddButton from "./AddButton";

/**
 * Persistent top bar across every page of svemir. Brand mark on the left,
 * primary nav (Graph, +Add) on the right.
 */
export default function TopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-neutral-800 bg-background/95 px-5 backdrop-blur">
      <div className="flex items-center gap-5">
        <BrandMark />
        <Suspense
          fallback={<div className="hidden h-6 w-64 md:block" aria-hidden />}
        >
          <TopBarSearch />
        </Suspense>
      </div>

      {/* Center — view switcher (home only), absolutely centered in the bar */}
      <Suspense fallback={null}>
        <ViewNav />
      </Suspense>

      <nav className="flex items-center gap-2 text-sm">
        <Suspense fallback={null}>
          <OrderDropdown />
        </Suspense>
        <Suspense
          fallback={
            <span className="flex items-center gap-1.5 rounded-xl border border-neutral-700 px-2.5 py-1 text-xs text-neutral-200">
              Add <span className="text-neutral-400">+</span>
            </span>
          }
        >
          <AddButton />
        </Suspense>
      </nav>
    </header>
  );
}
