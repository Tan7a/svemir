import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import TopBarSearch from "./TopBarSearch";
import ViewNav from "./ViewNav";
import OrderDropdown from "./OrderDropdown";

/**
 * Persistent top bar across every page of svemir. Brand mark on the left,
 * primary nav (Graph, +Add) on the right.
 */
export default function TopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-neutral-800 bg-[#0a0a0a]/95 px-5 backdrop-blur">
      <div className="flex items-center gap-5">
        <Link
          href="/"
          aria-label="svemir home"
          className="flex items-center"
        >
          <Image
            src="/svemir.svg"
            alt="svemir"
            width={40}
            height={13}
            priority
            className="h-auto w-10"
          />
        </Link>
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
        <Link
          href="/admin"
          className="flex items-center gap-1.5 rounded-md border border-neutral-700 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-900"
        >
          Add <span className="text-neutral-400">+</span>
        </Link>
      </nav>
    </header>
  );
}
