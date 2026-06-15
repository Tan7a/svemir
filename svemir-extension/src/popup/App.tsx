import { useEffect, useState } from "react";
import ChannelPicker from "../components/ChannelPicker";
import { extractAsset } from "../extract/extract";
import {
  createBlock,
  listChannels,
  listRecentChannels,
  suggestChannels,
  uploadImage,
} from "../lib/api";
import {
  clearPendingAsset,
  getPendingAsset,
  getSettings,
} from "../lib/storage";
import type {
  ExtractedAsset,
  RecentChannel,
  Settings,
  Suggestion,
} from "../lib/types";

type Phase =
  | { kind: "loading" }
  | { kind: "no-token" }
  | { kind: "ready" }
  | { kind: "snapshotting" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

// Hard cap on capture height — extremely tall pages would otherwise exhaust
// memory or hit CDP image limits.
const MAX_CAPTURE_HEIGHT = 30000;

/**
 * Capture the FULL page (entire scroll height) via the Chrome debugger
 * protocol. Page.captureScreenshot with captureBeyondViewport renders the whole
 * document in one clean image — no scroll-and-stitch seams. Requires the
 * "debugger" permission, so Chrome shows a "being debugged" banner while it
 * runs. Always detaches. Returns a JPEG data URL, or null on failure.
 */
async function captureFullPage(tabId: number): Promise<string | null> {
  const target = { tabId };
  await chrome.debugger.attach(target, "1.3");
  try {
    await chrome.debugger.sendCommand(target, "Page.enable");
    const metrics = (await chrome.debugger.sendCommand(
      target,
      "Page.getLayoutMetrics"
    )) as {
      cssContentSize?: { width: number; height: number };
      contentSize?: { width: number; height: number };
    };
    const size = metrics.cssContentSize ?? metrics.contentSize;
    if (!size) return null;
    const width = Math.ceil(size.width);
    const height = Math.min(Math.ceil(size.height), MAX_CAPTURE_HEIGHT);
    const shot = (await chrome.debugger.sendCommand(
      target,
      "Page.captureScreenshot",
      {
        format: "jpeg",
        quality: 80,
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width, height, scale: 1 },
      }
    )) as { data?: string };
    return shot?.data ? `data:image/jpeg;base64,${shot.data}` : null;
  } finally {
    try {
      await chrome.debugger.detach(target);
    } catch {
      /* tab closed / already detached */
    }
  }
}

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [asset, setAsset] = useState<ExtractedAsset | null>(null);
  const [editing, setEditing] = useState(false);
  const [recents, setRecents] = useState<RecentChannel[]>([]);
  const [allChannels, setAllChannels] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestKey, setSuggestKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [snapshotting, setSnapshotting] = useState(false);

  // Boot: load settings, extract or pick up pending asset, fetch recents.
  useEffect(() => {
    (async () => {
      const s = await getSettings();
      setSettings(s);
      if (!s.token) {
        setPhase({ kind: "no-token" });
        return;
      }

      // Channel fetches are independent of the asset extraction + snapshot,
      // so we start them immediately and let them resolve into state
      // whenever they're ready. The picker renders with empty recents until
      // they land — much less janky than waiting for snapshot+upload first.
      listRecentChannels(s)
        .then(setRecents)
        .catch((e) => console.warn("recents fetch failed:", e));
      listChannels(s)
        .then((all) => setAllChannels(all.map((c) => c.title)))
        .catch((e) => console.warn("all channels fetch failed:", e));

      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const tab = tabs[0];
      if (!tab?.id) {
        setPhase({ kind: "error", message: "No active tab" });
        return;
      }

      // Pending asset from right-click context menu?
      const pending = await getPendingAsset(tab.id);
      if (pending) {
        setAsset(pending);
        await clearPendingAsset(tab.id);
        setPhase({ kind: "ready" });
        return;
      }

      // Inject extractor on demand.
      let extracted: ExtractedAsset | null = null;
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractAsset,
        });
        extracted = (results[0]?.result as ExtractedAsset | undefined) ?? null;
      } catch (e) {
        console.warn("svemir extractor failed:", e);
      }
      if (!extracted) {
        extracted = {
          kind: "link",
          url: tab.url ?? "",
          title: tab.title ?? "",
          description: "",
          image_url: "",
          source_name: tab.url ? new URL(tab.url).hostname : "",
          body_text: "",
        };
      }
      setAsset(extracted);
      // Picker becomes interactive immediately; snapshot upload finishes
      // in the background and updates image_url when it lands.
      setPhase({ kind: "ready" });

      // Capture the FULL page (entire scroll height) as the block's image.
      // Overrides any OG image. Best-effort: failures keep the extracted (OG)
      // image_url as fallback. Runs without blocking the picker so the user can
      // pick channels while the capture + upload race in the background.
      try {
        setSnapshotting(true);
        const dataUrl = await captureFullPage(tab.id);
        if (dataUrl) {
          const blob = await dataUrlToBlob(dataUrl);
          const { url } = await uploadImage(s, blob, "page.jpg");
          setAsset((prev) => (prev ? { ...prev, image_url: url } : prev));
        }
      } catch (e) {
        console.warn("svemir snapshot failed:", e);
      } finally {
        setSnapshotting(false);
      }
    })();
  }, []);

  // Fetch suggestions once asset is loaded.
  useEffect(() => {
    if (!asset || !settings || !settings.token) return;
    let cancelled = false;
    (async () => {
      try {
        const out = await suggestChannels(settings, {
          title: asset.title,
          description: asset.description,
          source_name: asset.source_name,
        });
        if (!cancelled) {
          setSuggestions(out);
          setSuggestKey(`${asset.url}|${asset.title}`);
        }
      } catch (e) {
        console.warn("suggestions failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [asset, settings]);

  async function handleSave() {
    if (!settings || !asset) return;
    if (selected.length === 0) return;
    setPhase({ kind: "saving" });
    try {
      await createBlock(settings, asset, selected);
      setPhase({ kind: "saved" });
      setTimeout(() => window.close(), 800);
    } catch (e) {
      setPhase({
        kind: "error",
        message: e instanceof Error ? e.message : "Save failed",
      });
    }
  }

  function openSettings() {
    chrome.runtime.openOptionsPage();
  }

  // ── render ────────────────────────────────────────────────────────────

  if (phase.kind === "loading") {
    return <div className="p-6 text-sm text-neutral-400">Loading…</div>;
  }

  if (phase.kind === "no-token") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <div className="text-2xl">✻</div>
        <p className="text-center text-sm text-neutral-300">
          Welcome to svemir. Add your API token to start saving.
        </p>
        <button
          type="button"
          onClick={openSettings}
          className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white"
        >
          Open Settings
        </button>
      </div>
    );
  }

  if (!asset) {
    return <div className="p-6 text-sm text-neutral-400">No asset.</div>;
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-neutral-800 pb-3">
        <span className="text-base" aria-hidden>
          ✻
        </span>
        <span className="text-sm font-medium text-neutral-100">Connect</span>
        <div className="flex items-center gap-2 text-neutral-500">
          <button
            type="button"
            onClick={openSettings}
            className="hover:text-neutral-200"
            aria-label="Settings"
            title="Settings"
          >
            ⋯
          </button>
          <button
            type="button"
            onClick={() => window.close()}
            className="hover:text-neutral-200"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      </header>

      {/* Asset card */}
      <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
        <div className="flex items-center gap-3">
          {asset.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={asset.image_url}
              alt=""
              className="h-10 w-10 shrink-0 rounded border border-neutral-800 object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-neutral-800 bg-neutral-900 text-neutral-500">
              {asset.kind === "image" ? "📷" : "🔗"}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-neutral-100">
              {asset.title || asset.url || "(untitled)"}
            </div>
            {asset.source_name && (
              <div className="truncate text-xs text-neutral-500">
                {asset.source_name}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            {editing ? "Done" : "Edit"}
          </button>
        </div>

        {snapshotting && (
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-neutral-500">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400" />
            Capturing full page…
          </div>
        )}

        {editing && (
          <div className="mt-3 space-y-2">
            <input
              type="text"
              value={asset.title}
              onChange={(e) =>
                setAsset({ ...asset, title: e.target.value })
              }
              placeholder="Title"
              className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500"
            />
            <textarea
              value={asset.description}
              onChange={(e) =>
                setAsset({ ...asset, description: e.target.value })
              }
              placeholder="Description"
              rows={2}
              className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500"
            />
          </div>
        )}
      </div>

      <ChannelPicker
        value={selected}
        onChange={setSelected}
        suggestions={suggestions}
        recents={recents}
        allChannels={allChannels}
        autoApplyKey={suggestKey ?? undefined}
      />

      <button
        type="button"
        onClick={handleSave}
        disabled={selected.length === 0 || phase.kind === "saving"}
        className={`mt-1 rounded-md py-2.5 text-sm font-medium transition-colors ${
          selected.length === 0 || phase.kind === "saving"
            ? "bg-neutral-800 text-neutral-500"
            : "bg-indigo-600 text-white hover:bg-indigo-500"
        }`}
      >
        {phase.kind === "saving"
          ? "Saving…"
          : phase.kind === "saved"
          ? "Saved ✓"
          : `Connect to ${selected.length} channel${
              selected.length === 1 ? "" : "s"
            }`}
      </button>

      {phase.kind === "error" && (
        <p className="text-xs text-red-400">{phase.message}</p>
      )}
    </div>
  );
}
