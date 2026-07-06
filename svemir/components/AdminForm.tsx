"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  addItem,
  recentChannelsAction,
  suggestChannelsAction,
} from "@/app/admin/actions";
import ChannelPicker from "@/components/ChannelPicker";
import type { Suggestion } from "@/lib/suggest";
import type { RecentChannel } from "@/lib/channels";

type Kind = "link" | "image" | "text";

type Status =
  | { kind: "idle" }
  | { kind: "detecting"; label: string }
  | { kind: "scraping" }
  | { kind: "uploading" }
  | { kind: "saving" }
  | { kind: "success" }
  | { kind: "error"; message: string };

type SmartHint =
  | null
  | { kind: "link"; label: string }
  | { kind: "image"; label: string }
  | { kind: "text"; label: string };

const inputClass =
  "w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-500";

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
  const [kind, setKind] = useState<Kind>("link");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [channels, setChannels] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [smartHint, setSmartHint] = useState<SmartHint>(null);
  const [smartInput, setSmartInput] = useState("");
  const [smartDragOver, setSmartDragOver] = useState(false);

  const [recents, setRecents] = useState<RecentChannel[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestKey, setSuggestKey] = useState<string | null>(null);

  const lastFetchedUrl = useRef<string>("");
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // Initial: fetch recents.
  useEffect(() => {
    recentChannelsAction().then(setRecents).catch(() => {});
  }, []);

  // Cmd/Ctrl+Enter to save.
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
  }, [kind, url, title, description, imageUrl, sourceName, channels]);

  // Debounced channel suggester. Runs once title is non-empty and settles.
  useEffect(() => {
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (!title.trim()) {
      setSuggestions([]);
      setSuggestKey(null);
      return;
    }
    suggestTimer.current = setTimeout(async () => {
      try {
        const result = await suggestChannelsAction({
          title: title.trim(),
          description: description.trim(),
          source_name: sourceName.trim(),
        });
        setSuggestions(result);
        setSuggestKey(`${title}|${description}|${sourceName}`);
      } catch {
        /* ignore */
      }
    }, 1500);
    return () => {
      if (suggestTimer.current) clearTimeout(suggestTimer.current);
    };
  }, [title, description, sourceName]);

  function reset() {
    setUrl("");
    setTitle("");
    setDescription("");
    setImageUrl("");
    setSourceName("");
    setChannels([]);
    setKind("link");
    setSmartInput("");
    setSmartHint(null);
    setSuggestions([]);
    setSuggestKey(null);
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

  async function scrapeUrl(targetUrl: string) {
    if (targetUrl === lastFetchedUrl.current) return;
    lastFetchedUrl.current = targetUrl;
    setStatus({ kind: "scraping" });
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl }),
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
      setStatus({ kind: "idle" });
      setSmartHint({ kind: "link", label: new URL(targetUrl).hostname });
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : "Failed to scrape",
      });
    }
  }

  // Smart-entry: clipboard paste.
  const handleSmartPaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (items) {
        for (const it of items) {
          if (it.type.startsWith("image/")) {
            e.preventDefault();
            const blob = it.getAsFile();
            if (!blob) continue;
            const uploaded = await uploadImageBlob(blob);
            if (uploaded) {
              setKind("image");
              setImageUrl(uploaded);
              setSmartHint({
                kind: "image",
                label: `${(blob.size / 1024).toFixed(0)} KB uploaded`,
              });
              setSmartInput("");
            }
            return;
          }
        }
      }
      const text = e.clipboardData?.getData("text/plain") ?? "";
      const trimmed = text.trim();
      if (!trimmed) return;
      if (looksLikeUrl(trimmed)) {
        e.preventDefault();
        setKind("link");
        setUrl(trimmed);
        setSmartInput("");
        await scrapeUrl(trimmed);
        return;
      }
      // Plain text paste: treat as text block.
      e.preventDefault();
      setKind("text");
      setDescription((prev) => (prev ? `${prev}\n${trimmed}` : trimmed));
      if (!title.trim()) setTitle(trimmed.slice(0, 60));
      setSmartHint({ kind: "text", label: `${trimmed.length} chars` });
      setSmartInput("");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [title, description, imageUrl, sourceName]
  );

  // Smart-entry: drop file.
  const handleSmartDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setSmartDragOver(false);
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const file = files[0];
      if (file.type.startsWith("image/")) {
        const uploaded = await uploadImageBlob(file);
        if (uploaded) {
          setKind("image");
          setImageUrl(uploaded);
          setSmartHint({
            kind: "image",
            label: `${(file.size / 1024).toFixed(0)} KB uploaded`,
          });
        }
        return;
      }
      if (
        file.type === "text/plain" ||
        file.type === "text/markdown" ||
        file.name.endsWith(".txt") ||
        file.name.endsWith(".md")
      ) {
        const text = await file.text();
        setKind("text");
        setDescription(text);
        if (!title.trim()) {
          const stem = file.name.replace(/\.(txt|md)$/i, "");
          setTitle(stem);
        }
        setSmartHint({ kind: "text", label: `${text.length} chars` });
        return;
      }
      setStatus({
        kind: "error",
        message: `Unsupported file type: ${file.type || "unknown"}`,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [title]
  );

  // Smart-entry: blur with typed (non-URL) text → treat as text block.
  async function handleSmartBlur() {
    const trimmed = smartInput.trim();
    if (!trimmed) return;
    if (looksLikeUrl(trimmed)) {
      setKind("link");
      setUrl(trimmed);
      setSmartInput("");
      await scrapeUrl(trimmed);
      return;
    }
    setKind("text");
    setDescription((prev) => (prev ? `${prev}\n${trimmed}` : trimmed));
    if (!title.trim()) setTitle(trimmed.slice(0, 60));
    setSmartHint({ kind: "text", label: `${trimmed.length} chars` });
    setSmartInput("");
  }

  async function handleSave() {
    if (!title.trim()) {
      setStatus({ kind: "error", message: "Title is required" });
      return;
    }
    if (kind === "link" && !url.trim()) {
      setStatus({ kind: "error", message: "URL is required for link blocks" });
      return;
    }
    if (kind === "image" && !imageUrl.trim()) {
      setStatus({
        kind: "error",
        message:
          "Image URL is required for image blocks (paste a screenshot, drop an image, or paste a URL)",
      });
      return;
    }
    if (kind === "text" && !description.trim()) {
      setStatus({
        kind: "error",
        message: "Text content is required for text blocks",
      });
      return;
    }

    setStatus({ kind: "saving" });
    const result = await addItem({
      kind,
      url,
      title,
      description,
      image_url: imageUrl,
      source_name: sourceName,
      source_handle: "",
      source_type: "",
      categories: [],
      channelTitles: channels,
    });
    if (result.success) {
      const justAdded = [...channels];
      reset();
      setStatus({ kind: "success" });
      // Refresh recents so just-saved channels float to top.
      recentChannelsAction().then(setRecents).catch(() => {});
      // Best-effort: push the new titles into recents immediately for snappy UX.
      void justAdded;
    } else {
      setStatus({ kind: "error", message: result.error });
    }
  }

  const showUrl = kind === "link";
  const showImage = kind === "link" || kind === "image";
  const showSource = kind === "link";
  const descriptionRows = kind === "text" ? 10 : 3;
  const descriptionLabel = kind === "text" ? "Text" : "Description";

  return (
    <div ref={formRef} className="space-y-5">
      {/* Smart entry strip */}
      <div
        onPaste={handleSmartPaste}
        onDragOver={(e) => {
          e.preventDefault();
          setSmartDragOver(true);
        }}
        onDragLeave={() => setSmartDragOver(false)}
        onDrop={handleSmartDrop}
        className={`rounded-xl border border-dashed px-4 py-3 transition-colors ${
          smartDragOver
            ? "border-neutral-400 bg-neutral-900"
            : "border-neutral-700 bg-neutral-950"
        }`}
      >
        {smartHint ? (
          <div className="flex items-center justify-between text-sm">
            <span className="text-emerald-400">
              ✓ {smartHint.kind === "link" && "Link"}
              {smartHint.kind === "image" && "Image"}
              {smartHint.kind === "text" && "Text"}
              <span className="ml-2 text-neutral-400">{smartHint.label}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                setSmartHint(null);
                setSmartInput("");
              }}
              className="text-xs text-neutral-500 hover:text-neutral-200"
            >
              clear
            </button>
          </div>
        ) : (
          <>
            <input
              type="text"
              value={smartInput}
              onChange={(e) => setSmartInput(e.target.value)}
              onBlur={handleSmartBlur}
              placeholder="Paste a URL, drop an image, write or drop a text file…"
              className="w-full bg-transparent text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none"
              autoFocus
            />
            <p className="mt-1 text-[11px] text-neutral-500">
              Paste a URL → metadata fills automatically. Drop an image →
              uploads. Drop a <code>.txt</code> or <code>.md</code> → text
              block. Press{" "}
              <kbd className="rounded bg-neutral-800 px-1 text-neutral-300">
                ⌘ Enter
              </kbd>{" "}
              to save.
            </p>
          </>
        )}
      </div>

      {/* Kind tabs */}
      <div className="flex items-center gap-1 rounded-xl border border-neutral-800 bg-neutral-900 p-1 text-xs">
        {(["link", "image", "text"] as const).map((k) => {
          const active = kind === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`flex-1 rounded px-3 py-1.5 capitalize transition-colors ${
                active
                  ? "bg-neutral-100 text-neutral-900"
                  : "text-neutral-400 hover:text-neutral-100"
              }`}
            >
              {k}
            </button>
          );
        })}
      </div>

      {showUrl && (
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-300">
            URL
          </label>
          <div className="flex gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => url && scrapeUrl(url)}
              disabled={status.kind === "scraping"}
              className="shrink-0 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-60"
              title="Re-fetch metadata"
            >
              {status.kind === "scraping" ? "Fetching…" : "↻"}
            </button>
          </div>
        </div>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-300">
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
        <label className="mb-1 block text-sm font-medium text-neutral-300">
          {descriptionLabel}
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={descriptionRows}
          className={inputClass}
        />
      </div>

      {showImage && (
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-300">
            Image
          </label>
          <div className="flex gap-2">
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://… or use the smart entry above"
              className={inputClass}
            />
            {imageUrl && (
              <button
                type="button"
                onClick={() => setImageUrl("")}
                className="shrink-0 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
              >
                Clear
              </button>
            )}
          </div>
          {imageUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={imageUrl}
              alt=""
              className="mt-2 h-32 w-auto rounded-xl border border-neutral-800 object-cover"
            />
          )}
          {status.kind === "uploading" && (
            <p className="mt-1 text-xs text-neutral-500">Uploading…</p>
          )}
        </div>
      )}

      {showSource && (
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-300">
            Source
          </label>
          <input
            type="text"
            value={sourceName}
            onChange={(e) => setSourceName(e.target.value)}
            placeholder="Auto-filled from page metadata"
            className={inputClass}
          />
        </div>
      )}

      <div>
        <label className="mb-2 block text-sm font-medium text-neutral-300">
          Channels
        </label>
        <ChannelPicker
          value={channels}
          onChange={setChannels}
          suggestions={suggestions}
          recents={recents}
          autoApplyKey={suggestKey ?? undefined}
        />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={status.kind === "saving"}
          className="rounded-xl bg-neutral-100 px-5 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50 disabled:opacity-60"
        >
          {status.kind === "saving"
            ? "Saving…"
            : channels.length > 0
            ? `Connect to ${channels.length} channel${
                channels.length === 1 ? "" : "s"
              }`
            : "Save"}
        </button>
        {status.kind === "success" && (
          <span className="text-sm text-emerald-400">Saved.</span>
        )}
        {status.kind === "error" && (
          <span className="text-sm text-red-400">{status.message}</span>
        )}
      </div>
    </div>
  );
}
