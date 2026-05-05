"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ItemWithChannels } from "@/lib/types";
import ArchiveCard from "./ArchiveCard";
import SearchBar from "./SearchBar";
import FilterBar from "./FilterBar";
import ConnectPicker from "./ConnectPicker";
import BlockDetailModal from "./BlockDetailModal";
import BlockTable from "./BlockTable";

type View = "grid" | "table";
type Sort = "newest" | "oldest" | "alpha";

type Props = {
  items: ItemWithChannels[];
};

export default function ArchiveGrid({ items }: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [channelPickerOpen, setChannelPickerOpen] = useState(false);
  const [view, setView] = useState<View>("grid");
  const [sort, setSort] = useState<Sort>("newest");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const pickerRef = useRef<HTMLDivElement | null>(null);
  const sortRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (
        channelPickerOpen &&
        pickerRef.current &&
        !pickerRef.current.contains(e.target as Node)
      ) {
        setChannelPickerOpen(false);
      }
      if (
        sortMenuOpen &&
        sortRef.current &&
        !sortRef.current.contains(e.target as Node)
      ) {
        setSortMenuOpen(false);
      }
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [channelPickerOpen, sortMenuOpen]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = items.filter((item) => {
      if (
        selectedCategory !== "All" &&
        !item.categories.includes(selectedCategory)
      ) {
        return false;
      }
      if (selectedChannelIds.length > 0) {
        const itemChannelIds = new Set(item.channels.map((c) => c.id));
        for (const id of selectedChannelIds) {
          if (!itemChannelIds.has(id)) return false;
        }
      }
      if (!q) return true;
      const inTitle = item.title?.toLowerCase().includes(q) ?? false;
      const inDescription =
        item.description?.toLowerCase().includes(q) ?? false;
      const inChannels = item.channels.some((c) =>
        c.name.toLowerCase().includes(q)
      );
      const inSource = item.source_name?.toLowerCase().includes(q) ?? false;
      return inTitle || inDescription || inChannels || inSource;
    });

    const sorted = [...filtered];
    if (sort === "newest") {
      sorted.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    } else if (sort === "oldest") {
      sorted.sort((a, b) => (a.created_at > b.created_at ? 1 : -1));
    } else if (sort === "alpha") {
      sorted.sort((a, b) =>
        (a.title ?? "").localeCompare(b.title ?? "", undefined, {
          sensitivity: "base",
        })
      );
    }
    return sorted;
  }, [items, searchQuery, selectedCategory, selectedChannelIds, sort]);

  const activeItem = useMemo(
    () => (activeId ? items.find((i) => i.id === activeId) ?? null : null),
    [activeId, items]
  );

  const sortLabel: Record<Sort, string> = {
    newest: "Newest first",
    oldest: "Oldest first",
    alpha: "A → Z",
  };

  return (
    <div className="min-h-screen bg-[#FBF8F4]">
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-30 w-[calc(100%-2rem)] max-w-3xl">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <SearchBar value={searchQuery} onChange={setSearchQuery} />
          </div>
          <div className="relative" ref={pickerRef}>
            <button
              type="button"
              onClick={() => setChannelPickerOpen((v) => !v)}
              className={`shrink-0 rounded-full border border-white/50 px-4 py-2.5 text-xs font-medium backdrop-blur-xl shadow-sm transition-colors ${
                selectedChannelIds.length > 0 || channelPickerOpen
                  ? "bg-black text-white"
                  : "bg-white/30 text-zinc-700 hover:bg-white/50"
              }`}
            >
              Channels
              {selectedChannelIds.length > 0
                ? ` · ${selectedChannelIds.length}`
                : ""}
            </button>
            {channelPickerOpen && (
              <div className="absolute right-0 mt-2 w-80 rounded-2xl border border-white/50 bg-white/95 p-3 backdrop-blur-xl shadow-md">
                <ConnectPicker
                  selected={selectedChannelIds}
                  onChange={setSelectedChannelIds}
                  mode="filter"
                  allowCreate={false}
                />
              </div>
            )}
          </div>

          <div className="relative" ref={sortRef}>
            <button
              type="button"
              onClick={() => setSortMenuOpen((v) => !v)}
              className={`shrink-0 rounded-full border border-white/50 px-4 py-2.5 text-xs font-medium backdrop-blur-xl shadow-sm transition-colors ${
                sortMenuOpen
                  ? "bg-black text-white"
                  : "bg-white/30 text-zinc-700 hover:bg-white/50"
              }`}
            >
              {sortLabel[sort]}
            </button>
            {sortMenuOpen && (
              <div className="absolute right-0 mt-2 w-44 overflow-hidden rounded-2xl border border-white/50 bg-white/95 backdrop-blur-xl shadow-md">
                {(["newest", "oldest", "alpha"] as Sort[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setSort(s);
                      setSortMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs ${
                      sort === s
                        ? "bg-zinc-900 text-white"
                        : "text-zinc-700 hover:bg-zinc-100"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        sort === s ? "bg-white" : "bg-transparent"
                      }`}
                    />
                    {sortLabel[s]}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="hidden md:inline-flex shrink-0 rounded-full border border-white/50 bg-white/30 backdrop-blur-xl p-0.5 text-xs shadow-sm">
            {(["grid", "table"] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded-full px-3 py-1.5 capitalize ${
                  view === v ? "bg-black text-white" : "text-zinc-700"
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          <Link
            href="/channels"
            className="shrink-0 rounded-full border border-white/50 bg-white/30 px-4 py-2.5 text-xs font-medium text-zinc-700 backdrop-blur-xl shadow-sm hover:bg-white/50"
          >
            Channels
          </Link>
          <Link
            href="/graph"
            className="shrink-0 rounded-full border border-white/50 bg-white/30 px-4 py-2.5 text-xs font-medium text-zinc-700 backdrop-blur-xl shadow-sm hover:bg-white/50"
          >
            Graph
          </Link>
          <Link
            href="/admin"
            className="shrink-0 rounded-full border border-white/50 bg-black px-4 py-2.5 text-xs font-medium text-white backdrop-blur-xl shadow-sm hover:bg-zinc-800"
          >
            + Add
          </Link>
        </div>
      </div>

      <main className="px-4 sm:px-8 lg:px-12 pt-24 pb-32">
        {filtered.length === 0 ? (
          <div className="flex min-h-[40vh] items-center justify-center text-zinc-500">
            {items.length === 0 ? "Nothing here yet." : "No matches"}
          </div>
        ) : view === "grid" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 lg:gap-12">
            {filtered.map((item) => (
              <ArchiveCard
                key={item.id}
                item={item}
                onOpen={() => setActiveId(item.id)}
              />
            ))}
          </div>
        ) : (
          <BlockTable items={filtered} onOpen={(id) => setActiveId(id)} />
        )}
      </main>

      <div className="fixed bottom-4 left-4 z-30 text-xs text-zinc-500">
        {filtered.length} {filtered.length === 1 ? "post" : "posts"}
      </div>

      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30">
        <FilterBar selected={selectedCategory} onSelect={setSelectedCategory} />
      </div>

      {activeItem && (
        <BlockDetailModal
          item={activeItem}
          onClose={() => setActiveId(null)}
        />
      )}
    </div>
  );
}
