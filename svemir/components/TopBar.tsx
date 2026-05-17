import Link from "next/link";
import Image from "next/image";

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
        <div className="hidden items-center text-sm text-neutral-500 md:flex">
          <span aria-hidden className="mr-2">⌕</span>
          <input
            type="text"
            placeholder="Search svemir"
            className="w-56 bg-transparent text-neutral-300 placeholder:text-neutral-500 focus:outline-none"
          />
        </div>
      </div>
      <nav className="flex items-center gap-2 text-sm">
        <Link
          href="/graph"
          className="rounded-md px-2.5 py-1 text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
        >
          Graph
        </Link>
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
