"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ORDER_OPTIONS,
  CHANNEL_ORDER_OPTIONS,
  type OrderKind,
  type ViewKind,
} from "./FilterBar";
import { supabase } from "@/lib/supabase-client";
import { MenuPanel, MenuItem } from "./ui/Menu";
import Chevron from "./ui/Chevron";

// Sorts that operate on individual blocks (kind / category / source). Offered
// in both views; choosing one from Channels view also switches to Blocks.
const BLOCK_ONLY = new Set<OrderKind>(["type", "source", "vibes"]);

// The groupings that open a submenu of values you can filter by. Maps the
// order kind → the URL param that filters the grid (see app/page.tsx BlockFilter).
const FILTER_GROUPS: Partial<Record<OrderKind, { param: string; group: string }>> = {
  type: { param: "filterKind", group: "type" },
  source: { param: "filterSource", group: "source" },
};

const KIND_LABEL: Record<string, string> = {
  link: "Links",
  image: "Images",
  text: "Text",
  paper: "Papers",
};
const KIND_RANK: Record<string, number> = { link: 0, image: 1, text: 2, paper: 3 };

type Opt = { value: string; label: string; count: number };
type Values = { type: Opt[]; theme: Opt[]; source: Opt[] };

/**
 * Compact Order dropdown in the TopBar (home-only). Lists the vocabulary for
 * the current view (channels vs blocks), writes ?order= to the URL, and closes
 * on outside-click or Escape.
 *
 * The three groupings - By type / By theme / By source - expand inline into a
 * submenu of their real values; picking a value filters the grid to just that
 * value (?filterKind=/?filterTheme=/?filterSource=), while "All, grouped" keeps
 * the original clustering sort. No. of connections / Vibes stay single-click.
 */
export default function OrderDropdown() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<OrderKind | null>(null);
  const [values, setValues] = useState<Values | null>(null);
  const [loadingValues, setLoadingValues] = useState(false);
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

  // Lazily fetch the distinct kind / theme / source values the first time a
  // submenu is opened - a small columns-only scan through the anon client.
  async function ensureValues() {
    if (values || loadingValues || !supabase) return;
    setLoadingValues(true);
    const { data } = await supabase
      .from("items")
      .select("kind, source_name, categories")
      .limit(1000);
    const rows = (data ?? []) as {
      kind: string;
      source_name: string | null;
      categories: string[] | null;
    }[];
    const tally = (pick: (r: (typeof rows)[number]) => string[]) => {
      const m = new Map<string, number>();
      for (const r of rows)
        for (const v of pick(r)) if (v) m.set(v, (m.get(v) ?? 0) + 1);
      return m;
    };
    const kindMap = tally((r) => [r.kind]);
    const sourceMap = tally((r) => (r.source_name ? [r.source_name] : []));
    const themeMap = tally((r) => r.categories ?? []);
    const byCountDesc = (a: Opt, b: Opt) => b.count - a.count;
    setValues({
      type: [...kindMap.entries()]
        .map(([value, count]) => ({ value, label: KIND_LABEL[value] ?? value, count }))
        .sort((a, b) => (KIND_RANK[a.value] ?? 9) - (KIND_RANK[b.value] ?? 9)),
      source: [...sourceMap.entries()]
        .map(([value, count]) => ({ value, label: value, count }))
        .sort(byCountDesc)
        .slice(0, 30),
      theme: [...themeMap.entries()]
        .map(([value, count]) => ({ value, label: value, count }))
        .sort(byCountDesc)
        .slice(0, 30),
    });
    setLoadingValues(false);
  }

  if (pathname !== "/") return null;

  const view: ViewKind =
    searchParams.get("view") === "channels" ? "channels" : "blocks";

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

  // Which value filter (if any) is currently applied - drives the button label
  // and the selected dots in the submenus.
  const activeFilter: { group: string; value: string } | null =
    searchParams.get("filterKind")
      ? { group: "type", value: searchParams.get("filterKind")! }
      : searchParams.get("filterTheme")
        ? { group: "theme", value: searchParams.get("filterTheme")! }
        : searchParams.get("filterSource")
          ? { group: "source", value: searchParams.get("filterSource")! }
          : null;

  const currentLabel = activeFilter
    ? activeFilter.group === "type"
      ? KIND_LABEL[activeFilter.value] ?? activeFilter.value
      : activeFilter.value
    : options.find((o) => o.value === current)?.label ??
      options.find((o) => o.value === defaultOrder)?.label ??
      "Order";

  /** Clear any value filter - used by both sort picks and filter picks. */
  function clearFilters(sp: URLSearchParams) {
    sp.delete("filterKind");
    sp.delete("filterTheme");
    sp.delete("filterSource");
  }

  function choose(v: OrderKind) {
    const sp = new URLSearchParams(searchParams.toString());
    clearFilters(sp);
    sp.set("order", v);
    if (BLOCK_ONLY.has(v)) sp.set("view", "blocks");
    if (v === "random" || v === "vibes") {
      sp.set("r", Math.random().toString(36).slice(2, 8));
    } else {
      sp.delete("r");
    }
    router.push(`/?${sp.toString()}`, { scroll: false });
    setOpen(false);
  }

  function chooseFilter(param: string, value: string) {
    const sp = new URLSearchParams(searchParams.toString());
    clearFilters(sp);
    sp.set(param, value);
    sp.set("view", "blocks");
    // Filtering to a single value makes the grouping order moot - reset to the
    // default so the button reads the value, not a stale "By type".
    sp.delete("order");
    sp.delete("r");
    router.push(`/?${sp.toString()}`, { scroll: false });
    setOpen(false);
  }

  function toggleExpand(v: OrderKind) {
    setExpanded((cur) => (cur === v ? null : v));
    void ensureValues();
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex max-w-[10rem] items-center gap-1.5 rounded-xl px-2.5 py-1 text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
      >
        <span className="truncate">{currentLabel}</span>
        <Chevron open={open} className="shrink-0 text-neutral-500" />
      </button>
      {open && (
        <MenuPanel className="absolute right-0 z-40 mt-1 max-h-[70vh] min-w-[13rem] overflow-y-auto">
          {options.map((opt) => {
            const filterGroup = FILTER_GROUPS[opt.value];
            // A grouping that opens a submenu of filterable values.
            if (filterGroup) {
              const isExpanded = expanded === opt.value;
              const groupActive =
                activeFilter?.group === filterGroup.group || current === opt.value;
              const vals = values?.[filterGroup.group as keyof Values] ?? [];
              return (
                <div key={opt.value}>
                  <MenuItem
                    selected={groupActive}
                    onClick={() => toggleExpand(opt.value)}
                    leading={
                      <span
                        className={`h-1.5 w-1.5 rounded-full border ${
                          groupActive
                            ? "border-neutral-200 bg-neutral-200"
                            : "border-neutral-600"
                        }`}
                      />
                    }
                    label={opt.label}
                    trailing={<Chevron open={isExpanded} className="text-neutral-500" />}
                  />
                  {isExpanded && (
                    <div className="ml-4 border-l border-neutral-800 pl-1">
                      <MenuItem
                        selected={current === opt.value && !activeFilter}
                        onClick={() => choose(opt.value)}
                        label={
                          <span className="text-neutral-400">All, grouped</span>
                        }
                      />
                      {loadingValues && !values && (
                        <p className="px-3 py-2 text-xs text-neutral-600">Loading…</p>
                      )}
                      {vals.map((v) => {
                        const sel =
                          activeFilter?.group === filterGroup.group &&
                          activeFilter.value === v.value;
                        return (
                          <MenuItem
                            key={v.value}
                            selected={sel}
                            onClick={() => chooseFilter(filterGroup.param, v.value)}
                            label={<span className="truncate">{v.label}</span>}
                            trailing={
                              <span className="text-xs text-neutral-600">{v.count}</span>
                            }
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }
            // A plain, single-click order (newest, oldest, connections, vibes…).
            const active = current === opt.value && !activeFilter;
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
