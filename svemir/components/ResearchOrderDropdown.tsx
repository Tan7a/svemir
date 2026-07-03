"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MenuPanel, MenuItem } from "./ui/Menu";
import Chevron from "./ui/Chevron";

/**
 * Browse control for the Research page (/facets). "By theme" (default) keeps the
 * grouped theme directory; the other orders render the papers themselves as a
 * block grid, sorted. Writes ?order= and closes on outside-click / Escape -
 * mirrors OrderDropdown's affordance but scoped to /facets (no view/filter
 * machinery).
 */
const RESEARCH_ORDERS: { value: string; label: string }[] = [
  { value: "themes", label: "By theme" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "alphabetical", label: "Alphabetical" },
  { value: "source", label: "By source" },
];

export default function ResearchOrderDropdown() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // Only meaningful on the Research page - hidden everywhere else so it can
  // live in the shared TopBar next to the other pages' sort control.
  if (pathname !== "/facets") return null;

  const current = searchParams.get("order") ?? "themes";
  const currentLabel =
    RESEARCH_ORDERS.find((o) => o.value === current)?.label ?? "By theme";

  function choose(v: string) {
    const sp = new URLSearchParams(searchParams.toString());
    if (v === "themes") sp.delete("order");
    else sp.set("order", v);
    const qs = sp.toString();
    router.push(qs ? `/facets?${qs}` : "/facets", { scroll: false });
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
      >
        {currentLabel}
        <Chevron open={open} className="text-neutral-500" />
      </button>
      {open && (
        <MenuPanel className="absolute right-0 z-40 mt-1 min-w-[12rem]">
          {RESEARCH_ORDERS.map((opt) => {
            const active = current === opt.value;
            return (
              <MenuItem
                key={opt.value}
                selected={active}
                onClick={() => choose(opt.value)}
                leading={
                  <span
                    className={`h-1.5 w-1.5 rounded-full border ${
                      active
                        ? "border-neutral-200 bg-neutral-200"
                        : "border-neutral-600"
                    }`}
                  />
                }
                label={opt.label}
              />
            );
          })}
        </MenuPanel>
      )}
    </div>
  );
}
