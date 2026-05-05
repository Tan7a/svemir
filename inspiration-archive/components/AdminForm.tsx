"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { addItem } from "@/app/admin/actions";
import { CATEGORIES, SOURCE_TYPES } from "@/lib/constants";
import ConnectPicker, { pushRecentChannels } from "./ConnectPicker";

type Status =
  | { kind: "idle" }
  | { kind: "scraping" }
  | { kind: "saving" }
  | { kind: "uploading" }
  | { kind: "success" }
  | { kind: "error"; message: string };

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400";

function looksLikeUrl(s: string): boolean {
  if (!s) return false;
  try {
    const u = new URL(s.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export default function AdminForm() {
  const searchParams = useSearchParams();
  const preselectChannelId = searchParams.get("channel");

  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceHandle, setSourceHandle] = useState("");
  const [sourceType, setSourceType] = useState<string>("website");
  const [categories, setCategories] = useState<string[]>([]);
  const [channelIds, setChannelIds] = useState<string[]>(
    preselectChannelId ? [preselectChannelId] : []
  );
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const lastFetchedUrl = useRef<string>("");
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!looksLikeUrl(url)) return;
    if (url === lastFetchedUrl.current) return;
    if (status.kind === "scraping" || status.kind === "saving") return;
    if (title.trim() && imageUrl.trim()) return;

    const handle = setTimeout(() => {
      handleFetchMetadata(true);
    }, 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSave();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    url,
    title,
    description,
    imageUrl,
    sourceName,
    sourceHandle,
    sourceType,
    categories,
    channelIds,
    notes,
  ]);

  function reset() {
    setUrl("");
    setTitle("");
    setDescription("");
    setImageUrl("");
    setSourceName("");
    setSourceHandle("");
    setSourceType("website");
    setCategories([]);
    setChannelIds([]);
    setNotes("");
    lastFetchedUrl.current = "";
  }

  async function uploadImageBlob(blob: Blob): Promise<string | null> {
    setStatus({ kind: "uploading" });
    try {
      const fd = new FormData();
      fd.append("file", blob, "screenshot.png");
      const res = await fetch("/api/upload-image", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error", message: data.error ?? "Upload failed" });
        return null;
      }
      setStatus({ kind: "idle" });
      return data.url as string;
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : "Upload failed",
      });
      return null;
    }
  }

  async function handleFormPaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.type.startsWith("image/")) {
        e.preventDefault();
        const blob = it.getAsFile();
        if (!blob) continue;
        const newUrl = await uploadImageBlob(blob);
        if (newUrl) setImageUrl(newUrl);
        return;
      }
    }
    const text = e.clipboardData?.getData("text/plain");
    if (!url.trim() && text && looksLikeUrl(text)) {
      setUrl(text.trim());
    }
  }

  async function handleFetchMetadata(silent = false) {
    if (!url.trim()) {
      if (!silent) setStatus({ kind: "error", message: "Enter a URL first" });
      return;
    }
    lastFetchedUrl.current = url;
    setStatus({ kind: "scraping" });
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error", message: data.error ?? "Failed to scrape" });
        return;
      }
      if (data.title && !title.trim()) setTitle(data.title);
      if (data.description && !description.trim()) setDescription(data.description);
      if (data.image && !imageUrl.trim()) setImageUrl(data.image);
      if (data.siteName && !sourceName.trim()) setSourceName(data.siteName);
      if (data.sourceType) setSourceType(data.sourceType);
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : "Failed to scrape",
      });
    }
  }

  async function handleSave() {
    if (!url.trim() || !title.trim()) {
      setStatus({ kind: "error", message: "URL and title are required" });
      return;
    }
    setStatus({ kind: "saving" });
    const result = await addItem({
      url,
      title,
      description,
      image_url: imageUrl,
      source_name: sourceName,
      source_handle: sourceHandle,
      source_type: sourceType,
      categories,
      channelIds,
      notes,
    });
    if (result.success) {
      pushRecentChannels(channelIds);
      reset();
      setStatus({ kind: "success" });
    } else {
      setStatus({ kind: "error", message: result.error });
    }
  }

  function toggleCategory(cat: string) {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  }

  return (
    <div ref={formRef} onPaste={handleFormPaste} className="space-y-5">
      <p className="text-xs text-zinc-500">
        Paste a URL → metadata fills automatically. Paste a screenshot → uploads
        as the image. Press <kbd className="rounded bg-zinc-200 px-1">⌘ Enter</kbd> to save.
      </p>

      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-1">
          URL
        </label>
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            className={inputClass}
            autoFocus
          />
          <button
            type="button"
            onClick={() => handleFetchMetadata(false)}
            disabled={status.kind === "scraping"}
            className="shrink-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 disabled:opacity-60"
            title="Re-fetch metadata"
          >
            {status.kind === "scraping" ? "Fetching…" : "↻"}
          </button>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-1">
          Title
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-1">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className={inputClass}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-1">
          Image
        </label>
        <div className="flex gap-2">
          <input
            type="url"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://… or paste a screenshot anywhere on this page"
            className={inputClass}
          />
          {imageUrl && (
            <button
              type="button"
              onClick={() => setImageUrl("")}
              className="shrink-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-600"
            >
              Clear
            </button>
          )}
        </div>
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            className="mt-2 h-32 w-auto rounded-md border border-zinc-200 object-cover"
          />
        )}
        {status.kind === "uploading" && (
          <p className="mt-1 text-xs text-zinc-500">Uploading screenshot…</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1">
            Source name
          </label>
          <input
            type="text"
            value={sourceName}
            onChange={(e) => setSourceName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1">
            Source handle (optional)
          </label>
          <input
            type="text"
            value={sourceHandle}
            onChange={(e) => setSourceHandle(e.target.value)}
            placeholder="@username"
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-1">
          Source type
        </label>
        <select
          value={sourceType}
          onChange={(e) => setSourceType(e.target.value)}
          className={inputClass}
        >
          {SOURCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-2">
          Categories
        </label>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => {
            const active = categories.includes(cat);
            return (
              <button
                key={cat}
                type="button"
                onClick={() => toggleCategory(cat)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                  active
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "bg-white text-zinc-700 border-zinc-300 hover:border-zinc-500"
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-2">
          Channels
        </label>
        <ConnectPicker selected={channelIds} onChange={setChannelIds} />
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-1">
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className={inputClass}
          placeholder="Why this caught your eye…"
        />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={status.kind === "saving"}
          className="rounded-md bg-zinc-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {status.kind === "saving" ? "Saving…" : "Save"}
        </button>
        {status.kind === "success" && (
          <span className="text-sm text-green-700">Saved.</span>
        )}
        {status.kind === "error" && (
          <span className="text-sm text-red-600">{status.message}</span>
        )}
      </div>
    </div>
  );
}
