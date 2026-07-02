"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ORDER_OPTIONS,
  CHANNEL_ORDER_OPTIONS,
  type OrderKind,
  type ViewKind,
} from "./FilterBar";
import { MenuPanel, MenuItem } from "./ui/Menu";
import Chevron from "./ui/Chevron";

// Sorts that operate on individual blocks (kind / category / source). Offered
// in both views; choosing one from Channels view also switches to Blocks.
const BLOCK_ONLY = new Set<OrderKind>(["type", "theme", "source", "vibes"]);

/**
 * Compact Order dropdown in the TopBar (home-only). Lists the vocabulary for
 * the current view (channels vs blocks), writes ?order= to the URL, and closes
 * on outside-click or Escape — the same affordance pattern as ChannelActions.
 */
export default function OrderDropdown() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
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

  if (pathname !== "/") return null;

  const view: ViewKind =
    searchParams.get("view") === "channels" ? "channels" : "blocks";

  // In Channels view, append the block-centric sorts so they're discoverable
  // (keeping Random last); in Blocks view ORDER_OPTIONS already includes them.
  const blockExtras = ORDER_OPTIONS.filter((o) => BLOCK_ONLY.has(o.value));
  const options =
    view === "channels"
      ? [
          ...CHANNEL_ORDER_OPTIONS.filter((o) => o.value !== "random"),
          ...blockExtras,
          { value: "random" as OrderKind, label: "Random" },
        ]
      : ORDER_OPTIONS;
  const defaultOrder: OrderKind = view === "channels" ? "updated" : "newest";
  const current = (searchParams.get("order") as OrderKind | null) ?? defaultOrder;
  const currentLabel =
    options.find((o) => o.value === current)?.label ??
    options.find((o) => o.value === defaultOrder)?.label ??
    "Order";

  function choose(v: OrderKind) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("order", v);
    // Block-centric sorts only apply to blocks — switch the view so they take.
    if (BLOCK_ONLY.has(v)) sp.set("view", "blocks");
    // Random and Vibes re-shuffle on every pick — a throwaway seed changes the
    // URL so the navigation isn't a no-op / client-cache hit.
    if (v === "random" || v === "vibes") {
      sp.set("r", Math.random().toString(36).slice(2, 8));
    } else {
      sp.delete("r");
    }
    router.push(`/?${sp.toString()}`, { scroll: false });
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
          {options.map((opt) => {
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
