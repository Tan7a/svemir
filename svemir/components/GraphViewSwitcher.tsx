"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import KnowledgeGraph, {
  type GraphItem,
  type GraphConcept,
  type BlockConceptLink,
  type ManualEdge,
} from "./KnowledgeGraph";
import ConceptCloud from "./ConceptCloud";
import type { GardenChannel } from "./IdeaGarden";

// Garden is a heavy Three.js scene - only load its chunk when that tab is active,
// and never on the server (it touches WebGL / browser APIs).
const IdeaGarden = dynamic(() => import("./IdeaGarden"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-neutral-500">
      Growing garden…
    </div>
  ),
});

type View = "garden" | "topologies" | "concepts";
const VIEWS: { id: View; label: string }[] = [
  { id: "garden", label: "Garden" },
  { id: "topologies", label: "Map" },
  { id: "concepts", label: "Concepts" },
];

type GraphProps = {
  items: GraphItem[];
  manualEdges: ManualEdge[];
  concepts: GraphConcept[];
  blockConceptLinks: BlockConceptLink[];
};

type Props = { gardens: GardenChannel[]; graphProps: GraphProps };

/**
 * Multi-view shell for /graph. A floating top-center pill switches between the
 * 3D Garden, the (future) Topologies view, and the existing Concepts graph.
 * View is held in the URL (?view=) - consistent with ViewNav/OrderDropdown - and
 * each view mounts/unmounts so the WebGL context is freed when Garden is hidden.
 */
export default function GraphViewSwitcher({ gardens, graphProps }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const raw = sp.get("view");
  const view: View = raw === "topologies" || raw === "concepts" ? raw : "garden";

  function setView(v: View) {
    router.push(`/graph?view=${v}`, { scroll: false });
  }

  return (
    <div className="relative h-[calc(100vh-3rem)] w-full">
      <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-neutral-800 bg-neutral-950/85 p-0.5 text-xs backdrop-blur-md">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              className={`rounded-full px-3 py-1 transition-colors ${
                view === v.id
                  ? "bg-neutral-200 text-neutral-900"
                  : "text-neutral-400 hover:text-neutral-100"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {view === "garden" &&
        (gardens.length > 0 ? (
          <IdeaGarden gardens={gardens} />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-neutral-500">
            No channels with blocks yet - add some from{" "}
            <code className="ml-1 rounded bg-neutral-900 px-1">/admin</code>.
          </div>
        ))}

      {view === "topologies" && (
        <KnowledgeGraph
          items={graphProps.items}
          manualEdges={graphProps.manualEdges}
          concepts={graphProps.concepts}
          blockConceptLinks={graphProps.blockConceptLinks}
        />
      )}

      {view === "concepts" && (
        <div className="h-full overflow-y-auto px-5 pt-16 pb-10">
          <ConceptCloud
            concepts={graphProps.concepts.map((c) => ({
              id: c.id,
              slug: c.slug,
              term: c.term,
              count: c.blockCount,
            }))}
          />
        </div>
      )}
    </div>
  );
}
