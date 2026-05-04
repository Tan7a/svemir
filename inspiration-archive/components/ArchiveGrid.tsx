"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ItemWithTags } from "@/lib/types";
import ArchiveCard from "./ArchiveCard";
import SearchBar from "./SearchBar";
import FilterBar from "./FilterBar";

type Props = {
  items: ItemWithTags[];
};

export default function ArchiveGrid({ items }: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [tagPickerOpen, setTagPickerOpen] = useState(false);

  const allTags = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    items.forEach((item) =>
      item.tags.forEach((t) => {
        const existing = map.get(t.id);
        if (existing) existing.count += 1;
        else map.set(t.id, { id: t.id, name: t.name, count: 1 });
      })
    );
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [items]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (selectedCategory !== "All" && !item.categories.includes(selectedCategory)) {
        return false;
      }
      if (selectedTags.size > 0) {
        const itemTagIds = new Set(item.tags.map((t) => t.id));
        for (const tagId of selectedTags) {
          if (!itemTagIds.has(tagId)) return false;
        }
      }
      if (!q) return true;
      const inTitle = item.title?.toLowerCase().includes(q) ?? false;
      const inDescription = item.description?.toLowerCase().includes(q) ?? false;
      const inTags = item.tags.some((t) => t.name.toLowerCase().includes(q));
      const inSource = item.source_name?.toLowerCase().includes(q) ?? false;
      return inTitle || inDescription || inTags || inSource;
    });
  }, [items, searchQuery, selectedCategory, selectedTags]);

  function toggleTag(id: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-[#FBF8F4]">
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-30 w-[calc(100%-2rem)] max-w-2xl">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <SearchBar value={searchQuery} onChange={setSearchQuery} />
          </div>
          <button
            type="button"
            onClick={() => setTagPickerOpen((v) => !v)}
            className={`shrink-0 rounded-full border border-white/50 px-4 py-2.5 text-xs font-medium backdrop-blur-xl shadow-sm transition-colors ${
              selectedTags.size > 0 || tagPickerOpen
                ? "bg-black text-white"
                : "bg-white/30 text-zinc-700 hover:bg-white/50"
            }`}
          >
            Tags{selectedTags.size > 0 ? ` · ${selectedTags.size}` : ""}
          </button>
          <Link
            href="/graph"
            className="shrink-0 rounded-full border border-white/50 bg-white/30 px-4 py-2.5 text-xs font-medium text-zinc-700 backdrop-blur-xl shadow-sm hover:bg-white/50"
          >
            Graph
          </Link>
        </div>
        {tagPickerOpen && (
          <div className="mt-2 max-h-56 overflow-y-auto rounded-2xl border border-white/50 bg-white/70 p-3 backdrop-blur-xl shadow-sm">
            {allTags.length === 0 ? (
              <p className="text-xs text-zinc-500">No tags yet.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {allTags.map((t) => {
                  const active = selectedTags.has(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleTag(t.id)}
                      className={`rounded-full px-2.5 py-1 text-xs ${
                        active
                          ? "bg-black text-white"
                          : "bg-white text-zinc-700 hover:bg-zinc-50"
                      }`}
                    >
                      #{t.name} <span className="opacity-50">{t.count}</span>
                    </button>
                  );
                })}
                {selectedTags.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedTags(new Set())}
                    className="rounded-full px-2.5 py-1 text-xs text-zinc-500 hover:text-zinc-900"
                  >
                    clear
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <main className="px-4 sm:px-8 lg:px-12 pt-24 pb-32">
        {filtered.length === 0 ? (
          <div className="flex min-h-[40vh] items-center justify-center text-zinc-500">
            No matches
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 lg:gap-12">
            {filtered.map((item) => (
              <ArchiveCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </main>

      <div className="fixed bottom-4 left-4 z-30 text-xs text-zinc-500">
        {filtered.length} {filtered.length === 1 ? "post" : "posts"}
      </div>

      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30">
        <FilterBar selected={selectedCategory} onSelect={setSelectedCategory} />
      </div>
    </div>
  );
}
