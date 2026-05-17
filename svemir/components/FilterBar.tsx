"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";

export type ViewKind = "channels" | "blocks";
export type OrderKind =
  | "relevance"
  | "updated"
  | "newest"
  | "oldest"
  | "alphabetical"
  | "connections"
  | "random";

const VIEW_OPTIONS: { value: ViewKind; label: string }[] = [
  { value: "channels", label: "Channels" },
  { value: "blocks", label: "Blocks" },
];

const ORDER_OPTIONS: { value: OrderKind; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "updated", label: "Updated recently" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "alphabetical", label: "Alphabetical by title" },
  { value: "connections", label: "No. of connections" },
  { value: "random", label: "Random" },
];

const DEFERRED: Record<string, true> = {
  // these view options are listed in the are.na UI but not yet implemented.
  // Showing them disabled mirrors the visual layout without offering a path
  // that goes nowhere.
};

type Props = {
  view: ViewKind;
  order: OrderKind;
  blockCount: number;
  channelCount: number;
};

/**
 * Three-column filter bar — Info / View / Order. Matches the are.na IA in
 * `/Users/tanja/.claude/plans/can-you-tell-me-twinkly-thacker.md`.
 *
 * Selection persists in URL params (`?view=blocks&order=newest`). The Order
 * column is hidden when view=channels — channels don't share the Blocks
 * order vocabulary.
 */
export default function FilterBar({
  view,
  order,
  blockCount,
  channelCount,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const update = useCallback(
    (patch: Partial<{ view: ViewKind; order: OrderKind }>) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (patch.view) sp.set("view", patch.view);
      if (patch.order) sp.set("order", patch.order);
      const qs = sp.toString();
      router.push(`${pathname}${qs ? "?" + qs : ""}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  return (
    <div className="grid grid-cols-1 gap-8 px-5 py-6 text-sm text-neutral-300 md:grid-cols-3">
      {/* Info column */}
      <div>
        <div className="mb-3 text-neutral-500">Info</div>
        <div className="space-y-1.5">
          <div className="text-neutral-600">—</div>
          <div className="flex justify-between gap-4">
            <span className="text-neutral-400">Blocks</span>
            <span className="text-neutral-200">{blockCount}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-neutral-400">Channels</span>
            <span className="text-neutral-200">{channelCount}</span>
          </div>
        </div>
      </div>

      {/* View column */}
      <div>
        <div className="mb-3 text-neutral-500">View</div>
        <ul className="space-y-1.5">
          {VIEW_OPTIONS.map((opt) => {
            const active = view === opt.value;
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  onClick={() => update({ view: opt.value })}
                  className={`group flex items-center gap-2 text-left ${
                    active
                      ? "text-neutral-100"
                      : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 rounded-full border ${
                      active
                        ? "bg-neutral-200 border-neutral-200"
                        : "border-neutral-600"
                    }`}
                  />
                  {opt.label}
                </button>
              </li>
            );
          })}
          {(["Table", "Index", "All"] as const).map((label) => (
            <li key={label}>
              <span
                aria-disabled
                className="flex items-center gap-2 text-neutral-600"
                title="Coming in a later phase"
              >
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full border border-neutral-700"
                />
                {label}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Order column — hidden in channels view, like are.na */}
      <div className={view === "channels" ? "invisible md:visible" : undefined}>
        <div className="mb-3 text-neutral-500">Order</div>
        {view === "channels" ? null : (
          <ul className="space-y-1.5">
            {ORDER_OPTIONS.map((opt) => {
              const active = order === opt.value;
              const disabled = DEFERRED[opt.value] === true;
              return (
                <li key={opt.value}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => update({ order: opt.value })}
                    className={`flex items-center gap-2 text-left ${
                      disabled
                        ? "cursor-not-allowed text-neutral-600"
                        : active
                          ? "text-neutral-100"
                          : "text-neutral-400 hover:text-neutral-200"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`h-1.5 w-1.5 rounded-full border ${
                        active
                          ? "bg-neutral-200 border-neutral-200"
                          : "border-neutral-600"
                      }`}
                    />
                    {opt.label}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
