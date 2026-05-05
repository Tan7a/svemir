"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { ItemWithChannels } from "@/lib/types";
import { CATEGORY_PILL_CLASSES, colorForTag } from "@/lib/constants";
import {
  connectItemToChannels,
  disconnectItemFromChannel,
} from "@/app/admin/actions";
import ConnectPicker, { pushRecentChannels } from "./ConnectPicker";

type Props = {
  item: ItemWithChannels;
  onClose: () => void;
};

function safeImageUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  return url.startsWith("https://") ? url : null;
}

export default function BlockDetailModal({ item, onClose }: Props) {
  const [tab, setTab] = useState<"connections" | "connect">("connections");
  const [pickerSelected, setPickerSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  function onOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose();
  }

  const heroImage = safeImageUrl(item.image_url);

  async function handleConnect() {
    if (pickerSelected.length === 0) return;
    setBusy(true);
    setError(null);
    const r = await connectItemToChannels(item.id, pickerSelected);
    setBusy(false);
    if (r.success) {
      pushRecentChannels(pickerSelected);
      setPickerSelected([]);
      setTab("connections");
      // soft refresh — let server-rendered parents re-fetch on next nav
      // (parent ArchiveGrid will refetch via revalidatePath in the action)
    } else {
      setError(r.error);
    }
  }

  async function handleDisconnect(channelId: string) {
    if (!confirm("Remove this block from the channel?")) return;
    setBusy(true);
    setError(null);
    const r = await disconnectItemFromChannel(item.id, channelId);
    setBusy(false);
    if (!r.success) setError(r.error);
  }

  return (
    <div
      ref={overlayRef}
      onClick={onOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="grid h-full w-full max-w-7xl grid-rows-[1fr_auto] overflow-hidden rounded-2xl bg-[#FBF8F4] shadow-2xl md:grid-cols-[1fr_400px] md:grid-rows-1">
        <div className="relative flex items-center justify-center bg-zinc-100 p-4">
          {heroImage ? (
            <Image
              src={heroImage}
              alt={item.title}
              width={1200}
              height={900}
              className="max-h-full w-auto object-contain"
              unoptimized
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-200 text-zinc-400">
              No image
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 left-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-zinc-700 shadow-sm hover:bg-white"
          >
            ✕
          </button>
          <Link
            href={`/item/${item.id}`}
            className="absolute top-3 right-3 rounded-full bg-white/90 px-3 py-1.5 text-xs text-zinc-700 shadow-sm hover:bg-white"
            title="Open as standalone page"
          >
            ↗ Page
          </Link>
        </div>

        <div className="flex flex-col overflow-y-auto border-t border-zinc-200 md:border-l md:border-t-0">
          <div className="border-b border-zinc-200 p-5">
            {item.source_name && (
              <p className="text-xs text-zinc-500">
                {item.source_name}
                {item.source_handle ? ` · ${item.source_handle}` : ""}
              </p>
            )}
            <h2 className="mt-1 text-lg font-semibold leading-snug text-zinc-900">
              {item.title}
            </h2>
            {item.description && (
              <p className="mt-2 text-sm text-zinc-700 leading-relaxed">
                {item.description}
              </p>
            )}
            {item.notes && (
              <div className="mt-3 rounded-md border border-zinc-200 bg-white p-3 text-xs text-zinc-700 whitespace-pre-wrap">
                {item.notes}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
              >
                Open original ↗
              </a>
              {item.categories.length > 0 &&
                item.categories.map((cat) => (
                  <span
                    key={cat}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      CATEGORY_PILL_CLASSES[cat] ?? "bg-zinc-200 text-zinc-700"
                    }`}
                  >
                    {cat}
                  </span>
                ))}
            </div>
          </div>

          <div className="flex border-b border-zinc-200 text-xs">
            <button
              type="button"
              onClick={() => setTab("connections")}
              className={`flex-1 px-4 py-3 ${
                tab === "connections"
                  ? "bg-white text-zinc-900 font-medium border-b-2 border-zinc-900"
                  : "text-zinc-500 hover:text-zinc-900"
              }`}
            >
              Connections{" "}
              <span className="ml-1 text-zinc-400">{item.channels.length}</span>
            </button>
            <button
              type="button"
              onClick={() => setTab("connect")}
              className={`flex-1 px-4 py-3 ${
                tab === "connect"
                  ? "bg-white text-zinc-900 font-medium border-b-2 border-zinc-900"
                  : "text-zinc-500 hover:text-zinc-900"
              }`}
            >
              Connect →
            </button>
          </div>

          <div className="flex-1 p-5">
            {error && (
              <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </p>
            )}

            {tab === "connections" && (
              <div className="space-y-2">
                {item.channels.length === 0 ? (
                  <p className="text-xs text-zinc-500">
                    Not in any channel yet. Use Connect → to add it.
                  </p>
                ) : (
                  item.channels.map((ch) => {
                    const c = colorForTag(ch.id);
                    return (
                      <div
                        key={ch.id}
                        className="flex items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-2"
                      >
                        <Link
                          href={`/channel/${ch.slug}`}
                          className="flex items-center gap-2 flex-1 min-w-0"
                        >
                          <span
                            className={`h-2 w-2 rounded-full ${c.bg}`}
                            aria-hidden
                          />
                          <span className="truncate text-sm text-zinc-900 hover:underline">
                            {ch.name}
                          </span>
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleDisconnect(ch.id)}
                          disabled={busy}
                          className="text-xs text-zinc-400 hover:text-red-600 disabled:opacity-50"
                          aria-label={`Remove from ${ch.name}`}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {tab === "connect" && (
              <div className="space-y-3">
                <p className="text-xs text-zinc-500">
                  Add this block to more channels.
                </p>
                <ConnectPicker
                  selected={pickerSelected}
                  onChange={setPickerSelected}
                />
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={busy || pickerSelected.length === 0}
                  className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {busy
                    ? "Connecting…"
                    : `Connect to ${pickerSelected.length} channel${
                        pickerSelected.length === 1 ? "" : "s"
                      }`}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
