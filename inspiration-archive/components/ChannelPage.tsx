"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Channel, ItemWithChannels } from "@/lib/types";
import ArchiveCard from "@/components/ArchiveCard";
import BlockDetailModal from "@/components/BlockDetailModal";
import BlockTable from "@/components/BlockTable";
import {
  deleteChannel,
  renameChannel,
  updateChannelDescription,
} from "@/app/admin/actions";

type View = "grid" | "table";
type Sort = "position" | "newest" | "oldest" | "alpha";

type Props = {
  channel: Channel;
  items: ItemWithChannels[];
};

const SORT_LABELS: Record<Sort, string> = {
  position: "Manual order",
  newest: "Newest first",
  oldest: "Oldest first",
  alpha: "A → Z",
};

export default function ChannelPage({ channel, items }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<"none" | "name" | "description">(
    "none"
  );
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("grid");
  const [sort, setSort] = useState<Sort>("position");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sortRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sortMenuOpen) return;
    function onClick(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortMenuOpen(false);
      }
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [sortMenuOpen]);

  const sorted = useMemo(() => {
    const list = [...items];
    if (sort === "newest") {
      list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    } else if (sort === "oldest") {
      list.sort((a, b) => (a.created_at > b.created_at ? 1 : -1));
    } else if (sort === "alpha") {
      list.sort((a, b) =>
        (a.title ?? "").localeCompare(b.title ?? "", undefined, {
          sensitivity: "base",
        })
      );
    }
    // "position" — preserve incoming order from server (already position desc)
    return list;
  }, [items, sort]);

  const activeItem = useMemo(
    () => (activeId ? items.find((i) => i.id === activeId) ?? null : null),
    [activeId, items]
  );

  async function saveName() {
    if (!name.trim() || name === channel.name) {
      setEditing("none");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await renameChannel(channel.id, name);
    setBusy(false);
    if (r.success) {
      setEditing("none");
      router.refresh();
    } else {
      setError(r.error);
    }
  }

  async function saveDescription() {
    if (description === (channel.description ?? "")) {
      setEditing("none");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await updateChannelDescription(channel.id, description);
    setBusy(false);
    if (r.success) {
      setEditing("none");
      router.refresh();
    } else {
      setError(r.error);
    }
  }

  async function handleDelete() {
    if (
      !confirm(
        `Delete the channel "${channel.name}"? Items in it will stay in the archive but will be disconnected from this channel.`
      )
    )
      return;
    setBusy(true);
    setError(null);
    const r = await deleteChannel(channel.id);
    setBusy(false);
    if (r.success) {
      router.push("/channels");
    } else {
      setError(r.error);
    }
  }

  return (
    <div className="min-h-screen bg-[#FBF8F4]">
      <header className="border-b border-zinc-200 bg-[#FBF8F4]">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-4 text-sm">
          <nav className="flex items-center gap-2 text-zinc-500">
            <Link href="/archive" className="hover:text-zinc-900">
              Archive
            </Link>
            <span>/</span>
            <Link href="/channels" className="hover:text-zinc-900">
              Channels
            </Link>
            <span>/</span>
            <span className="text-zinc-900">{channel.name}</span>
          </nav>
          <Link
            href={`/admin?channel=${channel.id}`}
            className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
          >
            + Add to channel
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        <section className="grid gap-6 md:grid-cols-[2fr_1fr]">
          <div>
            {editing === "name" ? (
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveName();
                  }
                  if (e.key === "Escape") {
                    setName(channel.name);
                    setEditing("none");
                  }
                }}
                autoFocus
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-zinc-400"
              />
            ) : (
              <h1
                className="cursor-text text-2xl font-bold text-zinc-900 hover:text-zinc-700"
                onClick={() => setEditing("name")}
                title="Click to rename"
              >
                {channel.name}
              </h1>
            )}

            {editing === "description" ? (
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={saveDescription}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setDescription(channel.description ?? "");
                    setEditing("none");
                  }
                }}
                autoFocus
                rows={3}
                className="mt-2 w-full max-w-2xl rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
                placeholder="Describe this channel…"
              />
            ) : channel.description ? (
              <p
                className="mt-1 max-w-2xl cursor-text text-sm text-zinc-600 hover:text-zinc-900"
                onClick={() => setEditing("description")}
                title="Click to edit description"
              >
                {channel.description}
              </p>
            ) : (
              <button
                type="button"
                onClick={() => setEditing("description")}
                className="mt-1 text-xs text-zinc-400 hover:text-zinc-700"
              >
                + Add description
              </button>
            )}
          </div>

          <dl className="space-y-1 text-xs">
            <div className="flex justify-between gap-4 border-b border-zinc-200 py-1.5">
              <dt className="text-zinc-500">Length</dt>
              <dd className="font-medium text-zinc-900">{items.length}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-zinc-200 py-1.5">
              <dt className="text-zinc-500">Started</dt>
              <dd className="font-medium text-zinc-900">
                {new Date(channel.created_at).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </dd>
            </div>
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="mt-2 text-zinc-400 hover:text-red-600 disabled:opacity-50"
            >
              Delete channel
            </button>
            {error && (
              <p className="text-red-600">{error}</p>
            )}
          </dl>
        </section>

        <div className="flex items-center gap-2">
          <div className="relative" ref={sortRef}>
            <button
              type="button"
              onClick={() => setSortMenuOpen((v) => !v)}
              className={`shrink-0 rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium ${
                sortMenuOpen
                  ? "bg-zinc-900 text-white"
                  : "bg-white text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              {SORT_LABELS[sort]}
            </button>
            {sortMenuOpen && (
              <div className="absolute left-0 mt-2 w-44 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-md">
                {(["position", "newest", "oldest", "alpha"] as Sort[]).map(
                  (s) => (
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
                      {SORT_LABELS[s]}
                    </button>
                  )
                )}
              </div>
            )}
          </div>

          <div className="inline-flex shrink-0 rounded-full border border-zinc-200 bg-white p-0.5 text-xs">
            {(["grid", "table"] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded-full px-3 py-1 capitalize ${
                  view === v ? "bg-zinc-900 text-white" : "text-zinc-700"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {view === "grid" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            <Link
              href={`/admin?channel=${channel.id}`}
              className="flex aspect-[4/3] items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 bg-white/40 text-zinc-500 hover:border-zinc-500 hover:text-zinc-900 transition-colors"
            >
              <div className="text-center">
                <p className="text-2xl">+</p>
                <p className="mt-1 text-[11px] tracking-wide">⌘ ENTER</p>
              </div>
            </Link>
            {sorted.map((item) => (
              <ArchiveCard
                key={item.id}
                item={item}
                onOpen={() => setActiveId(item.id)}
              />
            ))}
          </div>
        ) : (
          <BlockTable items={sorted} onOpen={(id) => setActiveId(id)} />
        )}
      </main>

      {activeItem && (
        <BlockDetailModal
          item={activeItem}
          onClose={() => setActiveId(null)}
        />
      )}
    </div>
  );
}
