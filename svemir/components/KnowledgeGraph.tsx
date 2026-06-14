"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { forceCollide, forceX, forceY } from "d3-force-3d";
import { hueFromId } from "@/lib/constants";

// react-force-graph-2d's TypeScript generics don't survive next/dynamic, so
// we treat it as a permissive component and rely on our own GraphNode/GraphLink
// types inside callbacks.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-neutral-500">
      Loading graph…
    </div>
  ),
}) as ComponentType<Record<string, unknown>>;

export type GraphItem = {
  id: string;
  title: string;
  tagIds: string[];
  tagNames: string[];
  category: string | null;
};

export type ManualEdge = { a: string; b: string };

export type GraphConcept = {
  id: string;
  slug: string;
  term: string;
  blockCount: number;
};

export type BlockConceptLink = {
  blockId: string;
  conceptId: string;
  weight: number;
};

type Props = {
  items: GraphItem[];
  manualEdges?: ManualEdge[];
  concepts?: GraphConcept[];
  blockConceptLinks?: BlockConceptLink[];
};

type NodeKind = "block" | "concept";
type LinkKind = "manual" | "concept";

type GraphNode = {
  id: string;
  name: string;
  category: string | null;
  tags: string[];
  type: NodeKind;
  slug?: string;
  prevalence?: number;
  hue?: number; // concept nodes only
};

type GraphLink = {
  source: string;
  target: string;
  value: number;
  manual: boolean;
  kind: LinkKind;
  hue?: number; // concept links: the colour of the concept they lead to
};

const LABEL_ZOOM_THRESHOLD = 0.9;

// Blocks render as pale "tips"; concepts glow in their own colour.
const BLOCK_HEX = "#e8e8ea";
const CONCEPT_HEX = "#f59e0b"; // fallback only

const conceptNodeId = (id: string) => `concept:${id}`;

// World-space radius of a node's dot. Concept hubs scale with prevalence. Shared
// by the painter, the click hit-area, and the collision force so spacing matches
// what's drawn.
function nodeRadius(node: { type: NodeKind; prevalence?: number }): number {
  return node.type === "concept"
    ? 3 + Math.sqrt(node.prevalence ?? 1) * 1.3
    : 2.2;
}

export default function KnowledgeGraph({
  items,
  manualEdges = [],
  concepts = [],
  blockConceptLinks = [],
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<{
    d3Force: (
      name: string,
      force?: unknown
    ) =>
      | {
          strength?: (n: number) => unknown;
          distance?: (n: number) => unknown;
        }
      | undefined;
    d3ReheatSimulation?: () => void;
    zoomToFit?: (ms?: number, padding?: number) => void;
  } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // The node whose detail card is open, plus where (within the container) to
  // anchor the card. Cleared by clicking empty space.
  const [selected, setSelected] = useState<{
    node: GraphNode;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    function onResize() {
      if (!containerRef.current) return;
      const r = containerRef.current.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // The graph is concept-driven: blocks cluster around the concepts they share.
  // Blocks → concept hubs (faint amber), plus manual block↔block edges (bold,
  // the curatorial gesture). A block with no recurring concept simply floats on
  // its own until it shares one.
  const data = useMemo<{ nodes: GraphNode[]; links: GraphLink[] }>(() => {
    const validIds = new Set(items.map((i) => i.id));
    const byKey = new Map<string, GraphLink>();

    const nodes: GraphNode[] = items.map((i) => ({
      id: i.id,
      name: i.title,
      category: i.category,
      tags: i.tagNames,
      type: "block",
    }));

    for (const c of concepts) {
      nodes.push({
        id: conceptNodeId(c.id),
        name: c.term,
        category: null,
        tags: [],
        type: "concept",
        slug: c.slug,
        prevalence: c.blockCount,
        hue: hueFromId(c.id),
      });
    }

    const validConcept = new Set(concepts.map((c) => c.id));
    for (const l of blockConceptLinks) {
      if (!validIds.has(l.blockId) || !validConcept.has(l.conceptId)) continue;
      byKey.set(`bc:${l.blockId}|${l.conceptId}`, {
        source: l.blockId,
        target: conceptNodeId(l.conceptId),
        value: 1,
        manual: false,
        kind: "concept",
        hue: hueFromId(l.conceptId),
      });
    }

    const edgeKey = (s: string, t: string) =>
      s < t ? `${s}|${t}` : `${t}|${s}`;
    for (const me of manualEdges) {
      if (!validIds.has(me.a) || !validIds.has(me.b)) continue;
      byKey.set(edgeKey(me.a, me.b), {
        source: me.a,
        target: me.b,
        value: 5,
        manual: true,
        kind: "manual",
      });
    }

    return { nodes, links: Array.from(byKey.values()) };
  }, [items, concepts, blockConceptLinks, manualEdges]);

  // Cross-reference maps for the click card: which concepts a block mentions,
  // and which blocks mention a concept.
  const { blockToConcepts, conceptToBlocks } = useMemo(() => {
    const conceptById = new Map(concepts.map((c) => [c.id, c]));
    const itemById = new Map(items.map((i) => [i.id, i]));
    const b2c = new Map<string, GraphConcept[]>();
    const c2b = new Map<string, GraphItem[]>();
    for (const l of blockConceptLinks) {
      const c = conceptById.get(l.conceptId);
      const it = itemById.get(l.blockId);
      if (!c || !it) continue;
      if (!b2c.has(l.blockId)) b2c.set(l.blockId, []);
      b2c.get(l.blockId)!.push(c);
      if (!c2b.has(l.conceptId)) c2b.set(l.conceptId, []);
      c2b.get(l.conceptId)!.push(it);
    }
    return { blockToConcepts: b2c, conceptToBlocks: c2b };
  }, [items, concepts, blockConceptLinks]);

  // Tune the force simulation for a neuron-like layout.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || size.w === 0) return;

    // Repulsion fans bundles apart; links keep each block close to its concept.
    const charge = fg.d3Force("charge");
    if (charge?.strength) charge.strength(-120);
    const link = fg.d3Force("link");
    if (link?.distance) link.distance(34);

    // Collision: no two dots overlap (radius matches what's painted, + padding).
    fg.d3Force(
      "collide",
      forceCollide()
        .radius((n: { type: NodeKind; prevalence?: number }) => nodeRadius(n) + 3)
        .strength(0.9)
    );

    // Gentle pull toward the centre so disconnected blocks stay in a tidy field
    // instead of being flung to the far corners.
    fg.d3Force("x", forceX(0).strength(0.06));
    fg.d3Force("y", forceY(0).strength(0.06));

    fg.d3ReheatSimulation?.();
    // Re-fit after the simulation has had time to settle.
    const t = setTimeout(() => fg.zoomToFit?.(500, 60), 1800);
    return () => clearTimeout(t);
  }, [data, size.w]);

  return (
    <div ref={containerRef} className="relative h-[calc(100vh-3rem)] w-full">
      <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
        <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-neutral-800 bg-neutral-950/85 px-4 py-2 text-xs text-neutral-300 backdrop-blur-md">
          <span className="text-neutral-500">
            {data.nodes.length} nodes · {data.links.length} edges
          </span>
        </div>
      </div>
      {size.w > 0 && size.h > 0 && (
        <ForceGraph2D
          ref={fgRef}
          graphData={data}
          width={size.w}
          height={size.h}
          backgroundColor="#060606"
          minZoom={0.2}
          maxZoom={8}
          warmupTicks={20}
          cooldownTicks={200}
          d3VelocityDecay={0.3}
          enableNodeDrag={true}
          onNodeDragEnd={(raw: unknown) => {
            // Pin the node where it's dropped (Obsidian-style) so it stays put
            // while the rest of the graph keeps reacting around it.
            const n = raw as GraphNode & {
              x?: number;
              y?: number;
              fx?: number;
              fy?: number;
            };
            n.fx = n.x;
            n.fy = n.y;
          }}
          nodeLabel={(raw: unknown) => {
            const node = raw as GraphNode;
            if (node.type === "concept") {
              const c = `hsl(${node.hue ?? 40},85%,66%)`;
              return `<div style="background:#111;color:#fff;padding:8px 12px;border-radius:8px;font-size:12px;max-width:280px;line-height:1.4"><div style="font-weight:600;color:${c}">${escapeHtml(node.name)}</div><div style="opacity:.7;font-size:11px">${node.prevalence ?? 0} block${node.prevalence === 1 ? "" : "s"}</div></div>`;
            }
            const tagsToShow = node.tags.slice(0, 12);
            return `<div style="background:#111;color:#fff;padding:8px 12px;border-radius:8px;font-size:12px;max-width:280px;line-height:1.4"><div style="font-weight:600;margin-bottom:4px">${escapeHtml(node.name)}</div>${tagsToShow.length > 0 ? `<div style="opacity:.7;font-size:11px">${tagsToShow.map((t) => "#" + escapeHtml(t)).join(" ")}${node.tags.length > tagsToShow.length ? " …" : ""}</div>` : ""}</div>`;
          }}
          linkColor={(raw: unknown) => {
            const l = raw as GraphLink;
            if (l.kind === "manual") return "rgba(232,232,232,0.5)";
            return `hsla(${l.hue ?? 40}, 80%, 62%, 0.4)`;
          }}
          linkWidth={(raw: unknown) => {
            const l = raw as GraphLink;
            return l.kind === "manual" ? 1.6 : 0.7;
          }}
          linkCurvature={(raw: unknown) => {
            // Curved fibres read as organic / axon-like rather than wiry.
            const l = raw as GraphLink;
            return l.kind === "manual" ? 0.12 : 0.3;
          }}
          linkDirectionalParticles={(raw: unknown) =>
            (raw as GraphLink).kind === "concept" ? 2 : 0
          }
          linkDirectionalParticleWidth={1.4}
          linkDirectionalParticleSpeed={0.004}
          linkDirectionalParticleColor={(raw: unknown) =>
            `hsla(${(raw as GraphLink).hue ?? 40}, 90%, 70%, 0.9)`
          }
          onNodeClick={(raw: unknown, event: unknown) => {
            const node = raw as GraphNode;
            const ev = event as MouseEvent;
            const rect = containerRef.current?.getBoundingClientRect();
            setSelected({
              node,
              x: rect ? ev.clientX - rect.left : 0,
              y: rect ? ev.clientY - rect.top : 0,
            });
          }}
          onBackgroundClick={() => setSelected(null)}
          nodeCanvasObjectMode={() => "replace"}
          nodeCanvasObject={(
            raw: unknown,
            ctx: CanvasRenderingContext2D,
            globalScale: number
          ) => {
            const node = raw as GraphNode & { x?: number; y?: number };
            if (node.x === undefined || node.y === undefined) return;
            const isConcept = node.type === "concept";
            const r = nodeRadius(node);

            // Flat dot — no glow. Concepts in their own colour, blocks pale.
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
            ctx.fillStyle = isConcept ? `hsl(${node.hue ?? 40},80%,62%)` : BLOCK_HEX;
            ctx.fill();

            // Labels at a constant ON-SCREEN size (divide the world font by the
            // zoom), so names stay readable when zoomed out instead of shrinking.
            // Concepts are always labelled; block labels appear once somewhat
            // zoomed in, to avoid a wall of overlapping text.
            const showLabel = isConcept || globalScale >= LABEL_ZOOM_THRESHOLD;
            if (showLabel) {
              const fontSize = (isConcept ? 13 : 11) / globalScale;
              ctx.font = `${
                isConcept ? "600 " : ""
              }${fontSize}px Inter, system-ui, sans-serif`;
              ctx.fillStyle = isConcept
                ? `hsl(${node.hue ?? 40},80%,72%)`
                : "#cfcfd2";
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              const label =
                node.name.length > 36
                  ? node.name.slice(0, 34) + "…"
                  : node.name;
              ctx.fillText(label, node.x, node.y + r + 2 / globalScale);
            }
          }}
          nodePointerAreaPaint={(
            raw: unknown,
            color: string,
            ctx: CanvasRenderingContext2D
          ) => {
            // Defines the clickable/hoverable disc for each node (needed because
            // we fully custom-paint nodes above).
            const node = raw as GraphNode & { x?: number; y?: number };
            if (node.x === undefined || node.y === undefined) return;
            ctx.beginPath();
            ctx.arc(node.x, node.y, nodeRadius(node) + 2, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
          }}
        />
      )}

      {selected &&
        (() => {
          const node = selected.node;
          const isConcept = node.type === "concept";
          const rawConceptId = isConcept
            ? node.id.replace(/^concept:/, "")
            : null;
          const blockConcepts = !isConcept
            ? blockToConcepts.get(node.id) ?? []
            : [];
          const conceptBlocks =
            isConcept && rawConceptId
              ? conceptToBlocks.get(rawConceptId) ?? []
              : [];
          const CARD_W = 268;
          const left = Math.max(
            8,
            Math.min(selected.x + 14, size.w - CARD_W - 8)
          );
          const top = Math.max(8, Math.min(selected.y + 14, size.h - 260));
          return (
            <div
              className="pointer-events-auto absolute z-20 rounded-xl border border-neutral-800 bg-neutral-950/95 p-4 text-xs shadow-xl backdrop-blur-md"
              style={{ left, top, width: CARD_W }}
            >
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="absolute right-2.5 top-2 text-base leading-none text-neutral-600 hover:text-neutral-300"
                aria-label="Close"
              >
                ×
              </button>

              {isConcept ? (
                <>
                  <div
                    className="mb-1 pr-4 text-sm font-semibold"
                    style={{ color: CONCEPT_HEX }}
                  >
                    {node.name}
                  </div>
                  <div className="mb-3 text-neutral-500">
                    {(node.prevalence ?? conceptBlocks.length)} block
                    {(node.prevalence ?? conceptBlocks.length) === 1
                      ? ""
                      : "s"}{" "}
                    mention this
                  </div>
                  {conceptBlocks.length > 0 && (
                    <ul className="mb-3 space-y-1">
                      {conceptBlocks.slice(0, 6).map((b) => (
                        <li key={b.id} className="truncate">
                          <Link
                            href={`/block/${b.id}`}
                            className="text-neutral-300 hover:text-white hover:underline"
                          >
                            {b.title || "Untitled"}
                          </Link>
                        </li>
                      ))}
                      {conceptBlocks.length > 6 && (
                        <li className="text-neutral-600">
                          +{conceptBlocks.length - 6} more
                        </li>
                      )}
                    </ul>
                  )}
                  {node.slug && (
                    <Link
                      href={`/concept/${node.slug}`}
                      className="text-neutral-400 hover:text-white"
                    >
                      Open concept →
                    </Link>
                  )}
                </>
              ) : (
                <>
                  <div className="mb-1 pr-4 text-sm font-semibold text-neutral-100">
                    {node.name}
                  </div>
                  {node.category && (
                    <div className="mb-2 text-neutral-500">{node.category}</div>
                  )}
                  {node.tags.length > 0 && (
                    <div className="mb-2">
                      <div className="mb-1 text-neutral-600">Channels</div>
                      <div className="flex flex-wrap gap-1">
                        {node.tags.slice(0, 8).map((t) => (
                          <span
                            key={t}
                            className="rounded-full bg-neutral-900 px-2 py-0.5 text-neutral-300"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {blockConcepts.length > 0 && (
                    <div className="mb-3">
                      <div className="mb-1 text-neutral-600">Concepts</div>
                      <div className="flex flex-wrap gap-1">
                        {blockConcepts.slice(0, 8).map((c) => (
                          <Link
                            key={c.id}
                            href={`/concept/${c.slug}`}
                            className="rounded-full px-2 py-0.5 hover:underline"
                            style={{
                              color: CONCEPT_HEX,
                              background: "rgba(245,158,11,0.12)",
                            }}
                          >
                            {c.term}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                  <Link
                    href={`/block/${node.id}`}
                    className="text-neutral-400 hover:text-white"
                  >
                    Open block →
                  </Link>
                </>
              )}
            </div>
          );
        })()}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
