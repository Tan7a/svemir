"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { connectBlocks, disconnectBlocks } from "@/app/admin/actions";
import { supabase } from "@/lib/supabase-client";
import BlockPicker, { type PickableBlock } from "./BlockPicker";

type Props = {
  blockId: string;
  initial: PickableBlock[];
};

/**
 * The "Connected blocks" sub-section of the BlockDetail right column.
 * Holds local state for the picker + optimistically maintains the list so
 * the click feels instant; router.refresh() pulls in any server-side derived
 * state (e.g. graph revalidation).
 *
 * Below the manual list it surfaces "Suggested connections" - blocks that share
 * concepts with this one (TF-IDF-weighted, via the related_blocks RPC). These
 * are the system's guesses; promoting one calls the SAME connectBlocks action
 * as a manual connection, so the curatorial gesture stays the single source of
 * real edges. Suggestions are a progressive enhancement: if migration 0006
 * isn't applied (RPC missing) the section simply stays empty.
 */
export default function BlockConnections({ blockId, initial }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<PickableBlock[]>(initial);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const [suggestions, setSuggestions] = useState<PickableBlock[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let cancelled = false;
    (async () => {
      const { data, error } = await client.rpc("related_blocks", {
        p_block_id: blockId,
        p_limit: 8,
      });
      if (cancelled || error || !Array.isArray(data) || data.length === 0) return;
      const ids = (data as { other_id: string }[]).map((r) => r.other_id);
      const { data: rows } = await client
        .from("items")
        .select("id, title, image_url, kind")
        .in("id", ids);
      if (cancelled || !rows) return;
      const byId = new Map((rows as PickableBlock[]).map((r) => [r.id, r]));
      // Preserve the RPC's relevance ordering.
      setSuggestions(
        ids
          .map((id) => byId.get(id))
          .filter((b): b is PickableBlock => !!b)
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [blockId]);

  async function handlePick(b: PickableBlock) {
    if (items.some((x) => x.id === b.id)) {
      setPicking(false);
      return;
    }
    setBusy(true);
    setToast(null);
    const result = await connectBlocks(blockId, b.id);
    setBusy(false);
    if (result.success) {
      setItems((prev) =>
        prev.some((x) => x.id === b.id) ? prev : [...prev, b]
      );
      setPicking(false);
      router.refresh();
    } else {
      setToast({ kind: "error", message: result.error });
    }
  }

  async function handleDisconnect(otherId: string) {
    setBusy(true);
    setToast(null);
    const result = await disconnectBlocks(blockId, otherId);
    setBusy(false);
    if (result.success) {
      setItems((prev) => prev.filter((x) => x.id !== otherId));
      router.refresh();
    } else {
      setToast({ kind: "error", message: result.error });
    }
  }

  function dismissSuggestion(id: string) {
    setDismissed((prev) => new Set(prev).add(id));
  }

  // Hide suggestions that are already connected or were dismissed this session.
  const connectedIds = new Set(items.map((i) => i.id));
  const visibleSuggestions = suggestions.filter(
    (s) => !connectedIds.has(s.id) && !dismissed.has(s.id)
  );

  return (
    <div className="text-xs">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-neutral-500">
          Connected blocks{" "}
          <span className="ml-0.5 text-neutral-600">{items.length}</span>
        </span>
        <button
          type="button"
          onClick={() => setPicking((p) => !p)}
          disabled={busy}
          className="text-neutral-500 hover:text-neutral-200 disabled:opacity-40"
        >
          {picking ? "cancel" : "+ connect block"}
        </button>
      </div>

      {picking && (
        <div className="mb-2">
          <BlockPicker
            excludeId={blockId}
            excludeIds={items.map((i) => i.id)}
            onPick={handlePick}
            busy={busy}
          />
        </div>
      )}

      {items.length === 0 && !picking ? (
        <p className="text-neutral-600">No block connections yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((b) => (
            <li key={b.id} className="flex items-center gap-2">
              <Link
                href={`/block/${b.id}`}
                className="flex flex-1 items-center gap-2 truncate text-neutral-200 hover:underline"
              >
                <span className="relative h-6 w-6 shrink-0 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950">
                  {b.image_url ? (
                    <Image
                      src={b.image_url}
                      alt=""
                      fill
                      sizes="24px"
                      className="object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-[10px] text-neutral-600">
                      {b.kind === "text" ? "T" : b.kind === "link" ? "↗" : "•"}
                    </span>
                  )}
                </span>
                <span className="truncate">{b.title || "Untitled"}</span>
              </Link>
              <button
                type="button"
                onClick={() => handleDisconnect(b.id)}
                disabled={busy}
                aria-label={`Disconnect ${b.title || "block"}`}
                className="text-neutral-600 hover:text-neutral-300 disabled:opacity-40"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {visibleSuggestions.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-neutral-500">
            Suggested connections
            <span className="ml-1 text-neutral-700">via shared concepts</span>
          </div>
          <ul className="space-y-1.5">
            {visibleSuggestions.map((b) => (
              <li key={b.id} className="flex items-center gap-2">
                <Link
                  href={`/block/${b.id}`}
                  className="flex flex-1 items-center gap-2 truncate text-neutral-400 hover:text-neutral-200 hover:underline"
                >
                  <span className="relative h-6 w-6 shrink-0 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950">
                    {b.image_url ? (
                      <Image
                        src={b.image_url}
                        alt=""
                        fill
                        sizes="24px"
                        className="object-cover"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-[10px] text-neutral-600">
                        {b.kind === "text" ? "T" : b.kind === "link" ? "↗" : "•"}
                      </span>
                    )}
                  </span>
                  <span className="truncate">{b.title || "Untitled"}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => handlePick(b)}
                  disabled={busy}
                  className="text-neutral-500 hover:text-emerald-400 disabled:opacity-40"
                >
                  connect
                </button>
                <button
                  type="button"
                  onClick={() => dismissSuggestion(b.id)}
                  aria-label={`Dismiss ${b.title || "block"}`}
                  className="text-neutral-700 hover:text-neutral-400"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {toast && (
        <p
          className={`mt-2 ${
            toast.kind === "error" ? "text-red-400" : "text-emerald-400"
          }`}
        >
          {toast.message}
        </p>
      )}
    </div>
  );
}
