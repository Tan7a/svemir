"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { connectBlocks, disconnectBlocks } from "@/app/admin/actions";
import { supabase } from "@/lib/supabase-client";
import { useAuthed } from "@/lib/use-authed";
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
 *
 * Connected and suggested blocks share one card (ConnCard), rendered in the same
 * grid so the two sections read as a set. Signed-out visitors see both grids but
 * none of the curatorial controls (connect / disconnect / dismiss) - view only.
 */

function kindLabel(kind: PickableBlock["kind"]): string {
  return kind === "paper"
    ? "paper"
    : kind === "text"
      ? "note"
      : kind === "link"
        ? "link"
        : "image";
}

/**
 * One block in a connections grid. Image blocks show their thumbnail; image-less
 * blocks (papers, notes) show a text snippet instead of an empty box with a dot.
 * The hover overlay (owner-only) is either a disconnect × (connected) or
 * connect + dismiss (suggested).
 */
function ConnCard({
  block,
  overlay,
}: {
  block: PickableBlock;
  overlay?: React.ReactNode;
}) {
  const snippet = block.description?.trim() || block.title || "Untitled";
  return (
    <div className="group relative">
      <Link
        href={`/block/${block.id}`}
        className="block overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 transition-colors hover:border-neutral-700"
      >
        <div className="relative aspect-[4/3] w-full">
          {block.image_url ? (
            <Image
              src={block.image_url}
              alt=""
              fill
              sizes="(min-width: 640px) 200px, 45vw"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full flex-col gap-1 overflow-hidden p-2">
              <span className="text-[9px] uppercase tracking-wide text-neutral-600">
                {kindLabel(block.kind)}
              </span>
              <p className="line-clamp-4 text-[11px] leading-snug text-neutral-400">
                {snippet}
              </p>
            </div>
          )}
        </div>
      </Link>
      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-neutral-400">
        {block.title || "Untitled"}
      </p>
      {overlay && (
        // Actions float over the top-right of the card. Revealed on hover, and on
        // keyboard focus / touch (focus-within) so they aren't hover-only.
        <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100">
          {overlay}
        </div>
      )}
    </div>
  );
}

export default function BlockConnections({ blockId, initial }: Props) {
  const router = useRouter();
  const authed = useAuthed();
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
        .select("id, title, image_url, kind, description")
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
        {authed && (
          <button
            type="button"
            onClick={() => setPicking((p) => !p)}
            disabled={busy}
            className="text-neutral-500 hover:text-neutral-200 disabled:opacity-40"
          >
            {picking ? "cancel" : "+ connect block"}
          </button>
        )}
      </div>

      {authed && picking && (
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((b) => (
            <ConnCard
              key={b.id}
              block={b}
              overlay={
                authed ? (
                  <button
                    type="button"
                    onClick={() => handleDisconnect(b.id)}
                    disabled={busy}
                    aria-label={`Disconnect ${b.title || "block"}`}
                    className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-950/85 text-[11px] text-neutral-400 backdrop-blur transition-colors hover:text-neutral-100 disabled:opacity-40"
                  >
                    ×
                  </button>
                ) : undefined
              }
            />
          ))}
        </div>
      )}

      {visibleSuggestions.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-neutral-500">
            Suggested connections
            <span className="ml-1 text-neutral-700">via shared concepts</span>
          </div>
          {/* Same grid + card as connected, so the two sections read as a set. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {visibleSuggestions.map((b) => (
              <ConnCard
                key={b.id}
                block={b}
                overlay={
                  authed ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handlePick(b)}
                        disabled={busy}
                        className="rounded-full bg-neutral-950/85 px-2 py-0.5 text-[10px] text-neutral-200 backdrop-blur transition-colors hover:text-emerald-400 disabled:opacity-40"
                      >
                        connect
                      </button>
                      <button
                        type="button"
                        onClick={() => dismissSuggestion(b.id)}
                        aria-label={`Dismiss ${b.title || "block"}`}
                        className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-950/85 text-[11px] text-neutral-400 backdrop-blur transition-colors hover:text-neutral-100"
                      >
                        ×
                      </button>
                    </>
                  ) : undefined
                }
              />
            ))}
          </div>
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
