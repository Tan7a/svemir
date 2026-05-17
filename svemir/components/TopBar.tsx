import Link from "next/link";

/**
 * Persistent top bar across every page of svemir.
 *
 * Mirrors the are.na pattern: brand mark + search on the left, "New channel"
 * + counter + avatar on the right. The search and new-channel buttons are
 * non-functional in Phase A — they exist for the IA. Wiring comes in Phase B.
 */
export default function TopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-neutral-800 bg-[#0a0a0a]/95 px-5 backdrop-blur">
      <div className="flex items-center gap-4">
        <Link
          href="/"
          aria-label="svemir home"
          className="text-neutral-200 hover:text-white text-lg leading-none select-none"
        >
          ✻
        </Link>
        <div className="flex items-center text-sm text-neutral-500">
          <span aria-hidden className="mr-2">⌕</span>
          <input
            type="text"
            placeholder="Search svemir"
            className="w-64 bg-transparent text-neutral-300 placeholder:text-neutral-500 focus:outline-none"
            // Phase B: wire to a search route.
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md border border-neutral-700 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-900"
          // Phase B: open "new channel" modal.
        >
          New channel <span className="text-neutral-400">+</span>
        </button>
        <span className="text-xs text-neutral-500">0</span>
        <div
          aria-hidden
          className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-700 text-[10px] font-medium text-neutral-200"
        >
          T
        </div>
      </div>
    </header>
  );
}
