"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { GardenChannel, GardenRoot } from "./IdeaGarden";
import ConceptCloud, { type CloudConcept } from "./ConceptCloud";
import { CONCEPTS_EXPLAINER, textPaletteColor } from "@/lib/constants";

// The Garden is a heavy Three.js scene - load its chunk only in the browser,
// never on the server (it touches WebGL / browser APIs).
const IdeaGarden = dynamic(() => import("./IdeaGarden"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-neutral-500">
      Growing garden…
    </div>
  ),
});

type Selection =
  | { kind: "root"; root: GardenRoot }
  | { kind: "tree"; channelId: string }
  | null;

type Props = {
  gardens: GardenChannel[];
  roots: GardenRoot[];
  concepts: CloudConcept[];
};

/**
 * The Garden's shell: renders the scene full-bleed and owns the collapsible
 * concepts side panel. Panel state (open/closed + what is selected) lives
 * HERE, never in IdeaGarden props, so toggling the panel can never rebuild
 * the WebGL scene. The panel is an absolute overlay rather than a flex
 * sibling: the canvas mount is measured by a ResizeObserver, and a sibling
 * that changes the mount's width would trigger a resize feedback loop.
 *
 * Selections arrive from the scene (root or trunk clicks) via callbacks that
 * IdeaGarden reads through refs.
 */
export default function GardenShell({ gardens, roots, concepts }: Props) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);

  const channelsById = useMemo(() => {
    const m = new Map<string, GardenChannel>();
    for (const g of gardens) m.set(g.id, g);
    return m;
  }, [gardens]);

  function onRootSelect(root: GardenRoot) {
    setSelection({ kind: "root", root });
    setPanelOpen(true);
  }
  function onTreeSelect(channelId: string) {
    setSelection({ kind: "tree", channelId });
    setPanelOpen(true);
  }

  return (
    <div className="relative h-[calc(100vh-3rem)] w-full">
      <IdeaGarden
        gardens={gardens}
        roots={roots}
        onRootSelect={onRootSelect}
        onTreeSelect={onTreeSelect}
      />

      {/* Panel toggle, opposite the garden controls (left-4 top-4). */}
      <button
        type="button"
        onClick={() => setPanelOpen((v) => !v)}
        aria-pressed={panelOpen}
        className={`absolute right-4 top-4 z-40 rounded-full border border-neutral-800 bg-neutral-900/70 px-3 py-1 text-xs backdrop-blur transition-colors ${
          panelOpen ? "text-neutral-100" : "text-neutral-500 hover:text-neutral-300"
        }`}
      >
        Concepts
      </button>

      {panelOpen && (
        <aside
          // Desktop: a right-hand column that stays clear of the scrubber
          // pill (bottom center), the credits (bottom right) and the garden
          // controls (top left). Small screens: a bottom sheet instead.
          // flex column so detail views can pin "Back to all concepts" to the
          // card's bottom-left (mt-auto) while short content sits at the top.
          className="absolute z-40 flex flex-col overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950/85 p-4 backdrop-blur max-sm:inset-x-2 max-sm:bottom-2 max-sm:max-h-[55vh] sm:bottom-20 sm:right-3 sm:top-14 sm:w-80"
        >
          {selection === null && (
            <>
              <PanelHeader title="Concepts" onClose={() => setPanelOpen(false)} />
              {/* Body-size, primary ink: this is the panel's one line of real
                  prose, not a caption. */}
              <p className="mb-4 text-sm leading-relaxed text-neutral-100">
                {CONCEPTS_EXPLAINER}
              </p>
              <ConceptCloud concepts={concepts} compact />
            </>
          )}

          {selection?.kind === "root" && (
            <RootDetail
              root={selection.root}
              channelsById={channelsById}
              onBack={() => setSelection(null)}
              onClose={() => setPanelOpen(false)}
            />
          )}

          {selection?.kind === "tree" && (
            <TreeDetail
              channelId={selection.channelId}
              roots={roots}
              channelsById={channelsById}
              onSelectRoot={(root) => setSelection({ kind: "root", root })}
              onBack={() => setSelection(null)}
              onClose={() => setPanelOpen(false)}
            />
          )}
        </aside>
      )}
    </div>
  );
}

function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      {/* Heading recipe from the design system: text-lg font-light. */}
      <h2 className="text-lg font-light leading-snug text-neutral-100">
        {title}
      </h2>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close panel"
        className="text-lg leading-none text-neutral-500 hover:text-neutral-200"
      >
        ×
      </button>
    </div>
  );
}

function BackToConcepts({ onBack }: { onBack: () => void }) {
  return (
    // mt-auto pins it to the card's bottom edge, self-start to the left.
    <button
      type="button"
      onClick={onBack}
      className="mt-auto self-start pt-5 text-xs text-neutral-500 transition-colors hover:text-neutral-200"
    >
      ← Back to all concepts
    </button>
  );
}

/** What one root means: the two channels and the terms they share. */
function RootDetail({
  root,
  channelsById,
  onBack,
  onClose,
}: {
  root: GardenRoot;
  channelsById: Map<string, GardenChannel>;
  onBack: () => void;
  onClose: () => void;
}) {
  const a = channelsById.get(root.a);
  const b = channelsById.get(root.b);
  return (
    <>
      <PanelHeader
        title={`${a?.title ?? "Unknown"} and ${b?.title ?? "Unknown"}`}
        onClose={onClose}
      />
      <p className="mb-4 text-xs text-neutral-500">
        {root.sharedCount} shared concept{root.sharedCount === 1 ? "" : "s"}
      </p>
      <ul className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        {root.terms.map((t) => (
          <li key={t.slug}>
            <Link
              href={`/concept/${t.slug}`}
              className="text-sm transition-opacity hover:opacity-70"
              style={{ color: textPaletteColor(t.term) }}
            >
              {t.term}
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-col gap-1 border-t border-neutral-800 pt-4 text-xs">
        {[a, b].map(
          (g) =>
            g && (
              <Link
                key={g.id}
                href={`/channel/${g.slug}`}
                className="text-neutral-400 transition-colors hover:text-neutral-100"
              >
                Open {g.title} →
              </Link>
            )
        )}
      </div>
      <BackToConcepts onBack={onBack} />
    </>
  );
}

/** One tree's conceptual neighborhood: every root touching this channel. */
function TreeDetail({
  channelId,
  roots,
  channelsById,
  onSelectRoot,
  onBack,
  onClose,
}: {
  channelId: string;
  roots: GardenRoot[];
  channelsById: Map<string, GardenChannel>;
  onSelectRoot: (root: GardenRoot) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const channel = channelsById.get(channelId);
  const incident = roots.filter((r) => r.a === channelId || r.b === channelId);
  return (
    <>
      <PanelHeader title={channel?.title ?? "Unknown"} onClose={onClose} />
      {incident.length === 0 ? (
        <p className="text-xs leading-relaxed text-neutral-500">
          No shared concepts with other channels yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {incident.map((r) => {
            const otherId = r.a === channelId ? r.b : r.a;
            const other = channelsById.get(otherId);
            return (
              <li key={`${r.a}:${r.b}`}>
                <button
                  type="button"
                  onClick={() => onSelectRoot(r)}
                  className="w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-neutral-900"
                >
                  <span className="block text-sm text-neutral-200">
                    {other?.title ?? "Unknown"}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-neutral-500">
                    {r.terms.map((t) => t.term).join(", ")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {channel && (
        <div className="mt-5 border-t border-neutral-800 pt-4 text-xs">
          <Link
            href={`/channel/${channel.slug}`}
            className="text-neutral-400 transition-colors hover:text-neutral-100"
          >
            Open {channel.title} →
          </Link>
        </div>
      )}
      <BackToConcepts onBack={onBack} />
    </>
  );
}
