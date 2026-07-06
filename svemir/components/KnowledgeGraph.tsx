"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { forceCollide, forceX, forceY } from "d3-force-3d";
import { channelColor } from "@/lib/constants";
import { useThemePalette } from "@/lib/use-theme-palette";

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
  tags: string[]; // channel names (for the detail card / tooltip)
  tagIds: string[]; // channel ids (for stable colour)
  type: NodeKind;
  color: string;
  slug?: string;
  prevalence?: number;
  // Link degree (centrality) - drives node size, Obsidian-style.
  deg?: number;
};

type GraphLink = {
  source: string;
  target: string;
  value: number;
  manual: boolean;
  kind: LinkKind;
};

// Obsidian-ish layers: channel-less blocks are a neutral grey, concepts share a
// single warm accent so they read as a distinct layer over the channel colours.
const BLOCK_NEUTRAL = "#8b8b9a";
const CONCEPT_COLOR = "#e8b563";
const CONCEPT_HEX = "#f59e0b"; // detail-card accent

const conceptNodeId = (id: string) => `concept:${id}`;

// Normalise a link endpoint to its id - force-graph mutates source/target from
// id strings into node objects once the simulation runs.
function linkEndId(end: unknown): string {
  return typeof end === "object" && end !== null
    ? String((end as { id: string }).id)
    : String(end);
}

// World-space radius of a node's dot - scales with its link count (degree), so
// well-connected hubs read bigger. Shared by the painter, the click hit-area,
// and the collision force so spacing matches what's drawn.
function nodeRadius(node: { deg?: number }): number {
  return 2 + Math.sqrt(node.deg ?? 0) * 0.9;
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
  // The node the cursor is over - drives Obsidian-style neighbour highlighting.
  const [hoverId, setHoverId] = useState<string | null>(null);
  // The node whose detail card is open, plus where (within the container) to
  // anchor the card. Cleared by clicking empty space.
  const [selected, setSelected] = useState<{
    node: GraphNode;
    x: number;
    y: number;
  } | null>(null);
  // Click-to-focus: the clicked node stays highlighted (it + its neighbours)
  // until you click empty space - unlike hover, which follows the cursor.
  const [focusId, setFocusId] = useState<string | null>(null);
  // Filters: a positive selection of what to SHOW. Empty = show everything;
  // pick chips and only those stay visible. Keys are channel ids plus the
  // special CONCEPTS_KEY for the concept layer.
  const [shownKeys, setShownKeys] = useState<Set<string>>(() => new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Canvas colours can't ride the CSS-var ramp, so resolve them per theme.
  const palette = useThemePalette();

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

  // The graph is concept-driven: blocks link to the concept hubs they share,
  // plus manual block↔block edges (the curatorial gesture). Blocks are coloured
  // by their primary channel so clusters are legible; concepts share one accent.
  // A block with no recurring concept simply floats until it shares one.
  const data = useMemo<{ nodes: GraphNode[]; links: GraphLink[] }>(() => {
    const validIds = new Set(items.map((i) => i.id));
    const byKey = new Map<string, GraphLink>();

    const nodes: GraphNode[] = items.map((i) => ({
      id: i.id,
      name: i.title,
      category: i.category,
      tags: i.tagNames,
      tagIds: i.tagIds,
      type: "block",
      color: i.tagIds[0] ? channelColor(i.tagIds[0]) : BLOCK_NEUTRAL,
    }));

    for (const c of concepts) {
      nodes.push({
        id: conceptNodeId(c.id),
        name: c.term,
        category: null,
        tags: [],
        tagIds: [],
        type: "concept",
        color: CONCEPT_COLOR,
        slug: c.slug,
        prevalence: c.blockCount,
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

    const links = Array.from(byKey.values());

    // Degree centrality - how many edges each node has. Drives node size.
    const deg = new Map<string, number>();
    for (const l of links) {
      deg.set(l.source, (deg.get(l.source) ?? 0) + 1);
      deg.set(l.target, (deg.get(l.target) ?? 0) + 1);
    }
    for (const n of nodes) n.deg = deg.get(n.id) ?? 0;

    return { nodes, links };
  }, [items, concepts, blockConceptLinks, manualEdges]);

  // Adjacency for hover highlighting: id → set of directly-linked ids. Built from
  // the raw link endpoints (ids), so it survives the simulation mutating them.
  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of data.links) {
      const s = linkEndId(l.source);
      const t = linkEndId(l.target);
      if (!m.has(s)) m.set(s, new Set());
      if (!m.has(t)) m.set(t, new Set());
      m.get(s)!.add(t);
      m.get(t)!.add(s);
    }
    return m;
  }, [data]);

  // id → node lookup, used by the filter's link-visibility test.
  const nodeById = useMemo(() => {
    const m = new Map<string, GraphNode>();
    for (const n of data.nodes) m.set(n.id, n);
    return m;
  }, [data]);

  // "Well-connected" threshold: roughly the 90th-percentile degree. Nodes at or
  // above this reveal their label at the lowest zoom; the reveal is scaled
  // between 0 and this so hubs name themselves first.
  const hubDeg = useMemo(() => {
    const degs = data.nodes
      .map((n) => n.deg ?? 0)
      .filter((d) => d > 0)
      .sort((a, b) => a - b);
    if (degs.length === 0) return 1;
    const p90 = degs[Math.floor(degs.length * 0.9)] ?? degs[degs.length - 1];
    return Math.max(1, p90);
  }, [data]);

  // Nodes sorted by degree (busiest first). The label pass walks this order so
  // hubs claim their space before smaller nodes - the key to a readable graph.
  const nodesByDegree = useMemo(
    () => [...data.nodes].sort((a, b) => (b.deg ?? 0) - (a.deg ?? 0)),
    [data]
  );

  // Distinct primary channels (a block's first channel) for the filter chips.
  // Channel-less blocks collapse into one "No channel" group so they're
  // toggleable too.
  const NO_CHANNEL = "__none__";
  const CONCEPTS_KEY = "__concepts__";
  const channelList = useMemo(() => {
    const m = new Map<string, { id: string; name: string; color: string }>();
    for (const i of items) {
      const id = i.tagIds[0] ?? NO_CHANNEL;
      if (m.has(id)) continue;
      m.set(id, {
        id,
        name: id === NO_CHANNEL ? "No channel" : i.tagNames[0] ?? "Channel",
        color: id === NO_CHANNEL ? BLOCK_NEUTRAL : channelColor(id),
      });
    }
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  // A node passes the filter when nothing is selected (show all) or when its
  // key is in the selection. Shared by node + link visibility and focus reset.
  const isNodeVisible = useMemo(() => {
    return (n: GraphNode) => {
      if (shownKeys.size === 0) return true;
      if (n.type === "concept") return shownKeys.has(CONCEPTS_KEY);
      const ch = n.tagIds[0] ?? NO_CHANNEL;
      return shownKeys.has(ch);
    };
  }, [shownKeys]);

  // If the focused node gets filtered out, drop the focus so the map doesn't
  // stay dimmed around something you can no longer see.
  useEffect(() => {
    if (focusId === null) return;
    const n = nodeById.get(focusId);
    if (!n || !isNodeVisible(n)) setFocusId(null);
  }, [focusId, nodeById, isNodeVisible]);

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

  // Neo4j-style "magnet": strong, short links pull connected nodes into tight
  // clusters, while only mild repulsion keeps them from overlapping and light
  // gravity holds the whole map together. The previous strong-repulsion /
  // weak-link mix strung everything out - this flips that ratio so groups clump.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || size.w === 0) return;

    const charge = fg.d3Force("charge");
    if (charge?.strength) charge.strength(-40);
    const link = fg.d3Force("link");
    if (link?.distance) link.distance(22);
    if (link?.strength) link.strength(0.6);
    fg.d3Force(
      "collide",
      forceCollide()
        .radius((n: { deg?: number }) => nodeRadius(n) + 4)
        .strength(1)
    );
    fg.d3Force("x", forceX(0).strength(0.06));
    fg.d3Force("y", forceY(0).strength(0.06));

    fg.d3ReheatSimulation?.();
    const t = setTimeout(() => fg.zoomToFit?.(600, 70), 1400);
    return () => clearTimeout(t);
  }, [data, size.w]);

  // Hover follows the cursor; click "pins" a focus. Hover wins while active so
  // you can still peek at other nodes without losing your pinned selection.
  const activeId = hoverId ?? focusId;
  const anyFilter = shownKeys.size > 0;

  return (
    <div ref={containerRef} className="relative h-[calc(100vh-3rem)] w-full">
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 text-xs text-neutral-600">
        {data.nodes.length} nodes · {data.links.length} links
      </div>

      {/* Filter panel: pick chips to SELECT what's visible (empty = show all).
          Uses the graph's visibility accessors, so toggling never re-runs the
          layout. */}
      <div className="absolute left-3 top-3 z-20 text-xs">
        <button
          type="button"
          onClick={() => setFiltersOpen((o) => !o)}
          className="rounded-full border border-neutral-800 bg-neutral-900/70 px-3 py-1 text-neutral-300 backdrop-blur transition-colors hover:text-neutral-100"
        >
          Filters
          {anyFilter && (
            <span className="ml-1 text-neutral-500">· {shownKeys.size}</span>
          )}
        </button>
        {filtersOpen && (
          <div className="mt-2 max-h-[60vh] w-56 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950/95 p-2 shadow-xl backdrop-blur-md">
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="text-neutral-500">
                {anyFilter ? "Showing selected" : "Showing all"}
              </span>
              {anyFilter && (
                <button
                  type="button"
                  onClick={() => setShownKeys(new Set())}
                  className="text-neutral-500 hover:text-neutral-200"
                >
                  Show all
                </button>
              )}
            </div>
            {(() => {
              const toggle = (key: string) =>
                setShownKeys((prev) => {
                  const next = new Set(prev);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                });
              // "on" = will render. When nothing is selected everything is on;
              // once a selection exists, unselected chips read as excluded.
              const chip = (
                key: string,
                name: string,
                color: string,
                bold?: boolean
              ) => {
                const on = shownKeys.size === 0 || shownKeys.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggle(key)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-neutral-900"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: color, opacity: on ? 1 : 0.25 }}
                    />
                    <span
                      className={`truncate ${bold ? "font-semibold " : ""}${
                        on ? "text-neutral-100" : "text-neutral-600"
                      }`}
                    >
                      {name}
                    </span>
                  </button>
                );
              };
              return (
                <>
                  {chip(CONCEPTS_KEY, "Concepts", CONCEPT_COLOR, true)}
                  {channelList.map((c) => chip(c.id, c.name, c.color))}
                </>
              );
            })()}
          </div>
        )}
      </div>
      {size.w > 0 && size.h > 0 && (
        <ForceGraph2D
          ref={fgRef}
          graphData={data}
          width={size.w}
          height={size.h}
          backgroundColor={palette.bg}
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
          onNodeHover={(raw: unknown) => {
            const n = raw as GraphNode | null;
            setHoverId(n ? n.id : null);
          }}
          linkVisibility={(raw: unknown) => {
            if (!anyFilter) return true;
            const l = raw as GraphLink;
            const s = nodeById.get(linkEndId(l.source));
            const t = nodeById.get(linkEndId(l.target));
            return !!s && !!t && isNodeVisible(s) && isNodeVisible(t);
          }}
          linkColor={(raw: unknown) => {
            const l = raw as GraphLink;
            if (activeId) {
              const touches =
                linkEndId(l.source) === activeId ||
                linkEndId(l.target) === activeId;
              if (!touches) return `rgba(${palette.inkRGB},0.025)`;
              return l.kind === "manual"
                ? `rgba(${palette.inkRGB},0.55)`
                : `rgba(${palette.inkRGB},0.32)`;
            }
            return l.kind === "manual"
              ? `rgba(${palette.inkRGB},0.3)`
              : `rgba(${palette.inkRGB},0.14)`;
          }}
          linkWidth={(raw: unknown) => {
            const l = raw as GraphLink;
            const base = l.kind === "manual" ? 1.2 : 0.6;
            if (
              activeId &&
              (linkEndId(l.source) === activeId ||
                linkEndId(l.target) === activeId)
            ) {
              return base + 0.8;
            }
            return base;
          }}
          linkCurvature={0}
          onNodeClick={(raw: unknown, event: unknown) => {
            const node = raw as GraphNode;
            const ev = event as MouseEvent;
            const rect = containerRef.current?.getBoundingClientRect();
            // Pin focus on this node (dims all but it + neighbours) and open
            // its detail card.
            setFocusId(node.id);
            setSelected({
              node,
              x: rect ? ev.clientX - rect.left : 0,
              y: rect ? ev.clientY - rect.top : 0,
            });
          }}
          onBackgroundClick={() => {
            setSelected(null);
            setFocusId(null);
          }}
          nodeVisibility={(raw: unknown) => {
            if (!anyFilter) return true;
            return isNodeVisible(raw as GraphNode);
          }}
          nodeCanvasObjectMode={() => "replace"}
          nodeCanvasObject={(raw: unknown, ctx: CanvasRenderingContext2D) => {
            const node = raw as GraphNode & { x?: number; y?: number };
            if (node.x === undefined || node.y === undefined) return;
            const r = nodeRadius(node);

            // Dimming: when a node is hovered or focused (clicked), fade
            // everything that isn't it or one of its direct neighbours.
            const dim =
              activeId !== null &&
              node.id !== activeId &&
              !neighbors.get(activeId)?.has(node.id);
            ctx.globalAlpha = dim ? 0.12 : 1;

            // Flat dot - no glow. Blocks in their channel colour, concepts amber.
            // Labels are drawn separately in onRenderFramePost so we can cull
            // overlaps globally (Obsidian-style) rather than per-node.
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
            ctx.fillStyle = node.color;
            ctx.fill();

            ctx.globalAlpha = 1;
          }}
          onRenderFramePost={(ctx: CanvasRenderingContext2D, globalScale: number) => {
            // ── Obsidian-style label pass ────────────────────────────────────
            // The unreadable version drew every node's label, so hundreds piled
            // on top of each other. Instead we walk nodes busiest-first and only
            // draw a label if its box doesn't overlap one already placed - so the
            // most-connected nodes always win their space and the rest stay
            // hidden until you zoom in (smaller text ⇒ more labels fit). On
            // hover/focus we show only that node + its neighbours.
            const placed: { x0: number; y0: number; x1: number; y1: number }[] =
              [];
            const pad = 3 / globalScale; // breathing room between labels (screen px)

            const inActiveSet = (id: string) =>
              activeId !== null &&
              (id === activeId || !!neighbors.get(activeId)?.has(id));

            for (const node of nodesByDegree) {
              const n = node as GraphNode & { x?: number; y?: number };
              if (n.x === undefined || n.y === undefined) continue;
              if (anyFilter && !isNodeVisible(n)) continue;

              // When something is active, only its neighbourhood is labelled.
              if (activeId !== null && !inActiveSet(n.id)) continue;

              const isConcept = n.type === "concept";
              const highlighted = inActiveSet(n.id);

              // Zoom fade, led earlier for well-connected nodes.
              const degNorm = Math.min(1, (n.deg ?? 0) / hubDeg);
              const revealLead = isConcept ? 0.35 : 0.9;
              const baseStart = isConcept ? 0.4 : 1.1;
              const baseEnd = isConcept ? 1.1 : 2.0;
              const fadeStart = Math.max(0.2, baseStart - degNorm * revealLead);
              const fadeEnd = Math.max(fadeStart + 0.3, baseEnd - degNorm * revealLead);
              const alpha = highlighted
                ? 1
                : Math.max(
                    0,
                    Math.min(1, (globalScale - fadeStart) / (fadeEnd - fadeStart))
                  );
              if (alpha <= 0.04) continue;

              // On-screen px grows with zoom, clamped to a readable band.
              const maxPx = isConcept ? 24 : 20;
              const grow = (isConcept ? 6 : 5) * globalScale;
              const screenPx = Math.min(maxPx, Math.max(11, grow));
              const fontSize = screenPx / globalScale;
              ctx.font = `${
                isConcept ? "600 " : ""
              }${fontSize}px Inter, system-ui, sans-serif`;

              const label =
                n.name.length > 36 ? n.name.slice(0, 34) + "…" : n.name;
              const w = ctx.measureText(label).width;
              const r = nodeRadius(n);
              const cx = n.x;
              const top = n.y + r + 2 / globalScale;
              const box = {
                x0: cx - w / 2 - pad,
                y0: top - pad,
                x1: cx + w / 2 + pad,
                y1: top + fontSize + pad,
              };

              // Collision cull: skip if this label overlaps an already-placed one.
              let clash = false;
              for (const p of placed) {
                if (
                  box.x0 < p.x1 &&
                  box.x1 > p.x0 &&
                  box.y0 < p.y1 &&
                  box.y1 > p.y0
                ) {
                  clash = true;
                  break;
                }
              }
              if (clash) continue;
              placed.push(box);

              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              // Subtle dark halo so text stays legible over links/dots.
              ctx.lineWidth = fontSize * 0.22;
              ctx.strokeStyle = `rgba(${palette.haloRGB},${0.85 * alpha})`;
              ctx.lineJoin = "round";
              ctx.strokeText(label, cx, top);
              ctx.fillStyle = `rgba(${palette.inkRGB},${alpha})`;
              ctx.fillText(label, cx, top);
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
                            className="text-neutral-300 hover:text-neutral-100 hover:underline"
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
                      className="text-neutral-400 hover:text-neutral-100"
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
                    className="text-neutral-400 hover:text-neutral-100"
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
