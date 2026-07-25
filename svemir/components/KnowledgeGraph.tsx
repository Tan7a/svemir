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
  tagSlugs: string[];
  category: string | null;
  img: string | null;
  kind: string;
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

type NodeKind = "block" | "concept" | "channel";
type LinkKind = "manual" | "concept" | "channel";

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
  img?: string | null; // block thumbnail for the detail card
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
const BLOCK_NEUTRAL = "#98989d"; // iOS systemGray
const CONCEPT_COLOR = "#e8b563";
const CONCEPT_HEX = "#f59e0b"; // detail-card accent

const conceptNodeId = (id: string) => `concept:${id}`;
const channelNodeId = (id: string) => `channel:${id}`;

/** Deterministic [0,1) from a string - keeps the constellation seeding stable. */
function hash01(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}


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
          strength?: (n: unknown) => unknown;
          distance?: (n: unknown) => unknown;
        }
      | undefined;
    d3ReheatSimulation?: () => void;
    zoomToFit?: (ms?: number, padding?: number) => void;
    centerAt?: (x?: number, y?: number, ms?: number) => void;
    zoom?: (k?: number, ms?: number) => void;
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
  // Blocks with no links at all (no channel, no shared concept, no manual
  // edge) settle on an outer ring - this hides them when they're just noise.
  const [hideUnconnected, setHideUnconnected] = useState(false);
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

  // The graph is curation-driven: every block links to its channel hubs (the
  // primary structure), to the concept hubs it shares (the automatic text
  // layer), and via manual block↔block edges (the curatorial gesture). Blocks
  // are coloured by their primary channel; concepts share one warm accent.
  //
  // Constellation seeding: channel hubs start evenly spaced on a ring, blocks
  // next to their primary hub, concepts near the centre. d3-force is
  // deterministic given fixed starting positions, so the map settles into the
  // same recognisable shape on every visit.
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
      img: i.img,
    }));

    // One hub per channel, discovered from the blocks themselves.
    const channelMeta = new Map<
      string,
      { name: string; slug: string; count: number }
    >();
    for (const i of items) {
      i.tagIds.forEach((id, idx) => {
        const meta = channelMeta.get(id) ?? {
          name: i.tagNames[idx] ?? "Channel",
          slug: i.tagSlugs[idx] ?? "",
          count: 0,
        };
        meta.count += 1;
        channelMeta.set(id, meta);
      });
    }
    for (const [id, meta] of channelMeta) {
      nodes.push({
        id: channelNodeId(id),
        name: meta.name,
        category: null,
        tags: [],
        // The raw channel id doubles as the filter key, so the existing
        // channel chips show/hide the hub together with its blocks.
        tagIds: [id],
        type: "channel",
        color: channelColor(id),
        slug: meta.slug,
        prevalence: meta.count,
      });
    }

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

    // Block → channel links: the curation layer, tinted per channel.
    for (const i of items) {
      for (const chId of new Set(i.tagIds)) {
        byKey.set(`ch:${i.id}|${chId}`, {
          source: i.id,
          target: channelNodeId(chId),
          value: 2,
          manual: false,
          kind: "channel",
        });
      }
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

    // ── constellation seeding ────────────────────────────────────────────────
    // Hubs on a ring (alphabetical, so adding blocks doesn't reshuffle), sized
    // so neighbouring hubs start ~40 world-units apart.
    type Seeded = GraphNode & { x?: number; y?: number };
    const hubs = [...channelMeta.keys()].sort((a, b) =>
      (channelMeta.get(a)!.name).localeCompare(channelMeta.get(b)!.name)
    );
    const R = Math.max(200, (hubs.length * 40) / (2 * Math.PI));
    const hubAngle = new Map<string, number>();
    hubs.forEach((id, i) => {
      const a = (i / hubs.length) * 2 * Math.PI - Math.PI / 2;
      hubAngle.set(id, a);
    });
    for (const n of nodes as Seeded[]) {
      if (n.type === "channel") {
        const a = hubAngle.get(n.tagIds[0]) ?? 0;
        n.x = Math.cos(a) * R;
        n.y = Math.sin(a) * R;
      } else if (n.type === "concept") {
        // Concepts bridge channels, so they start near the centre.
        const a = hash01(n.id, 1) * 2 * Math.PI;
        const d = hash01(n.id, 2) * R * 0.35;
        n.x = Math.cos(a) * d;
        n.y = Math.sin(a) * d;
      } else if (n.tagIds[0]) {
        // Blocks scatter around their primary channel's hub.
        const a = hubAngle.get(n.tagIds[0]) ?? 0;
        const ja = hash01(n.id, 3) * 2 * Math.PI;
        const jd = 12 + hash01(n.id, 4) * 36;
        n.x = Math.cos(a) * R + Math.cos(ja) * jd;
        n.y = Math.sin(a) * R + Math.sin(ja) * jd;
      } else {
        // Channel-less blocks start on a wider ring - they would drift there
        // anyway; seeding makes it deliberate and stable.
        const a = hash01(n.id, 5) * 2 * Math.PI;
        n.x = Math.cos(a) * R * 1.35;
        n.y = Math.sin(a) * R * 1.35;
      }
    }

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
  // key is in the selection. Channel hubs carry their raw channel id in
  // tagIds[0], so the same chips govern hub and members together. Shared by
  // node + link visibility and focus reset.
  const isNodeVisible = useMemo(() => {
    return (n: GraphNode) => {
      if (hideUnconnected && n.type === "block" && (n.deg ?? 0) === 0) {
        return false;
      }
      if (shownKeys.size === 0) return true;
      if (n.type === "concept") return shownKeys.has(CONCEPTS_KEY);
      const ch = n.tagIds[0] ?? NO_CHANNEL;
      return shownKeys.has(ch);
    };
  }, [shownKeys, hideUnconnected]);

  // If the focused node gets filtered out, drop the focus so the map doesn't
  // stay dimmed around something you can no longer see.
  useEffect(() => {
    if (focusId === null) return;
    const n = nodeById.get(focusId);
    if (!n || !isNodeVisible(n)) setFocusId(null);
  }, [focusId, nodeById, isNodeVisible]);

  // Search: type 2+ characters, Enter jumps to (and pins focus on) each match
  // in turn. Matching is a simple case-insensitive substring over node names.
  const [query, setQuery] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [] as GraphNode[];
    return data.nodes.filter(
      (n) => isNodeVisible(n) && n.name.toLowerCase().includes(q)
    );
  }, [query, data, isNodeVisible]);
  useEffect(() => setMatchIdx(0), [query]);

  const jumpToMatch = (idx: number) => {
    const n = matches[idx] as (GraphNode & { x?: number; y?: number }) | undefined;
    if (!n || n.x === undefined || n.y === undefined) return;
    fgRef.current?.centerAt?.(n.x, n.y, 600);
    fgRef.current?.zoom?.(3, 600);
    setFocusId(n.id);
  };

  // Cross-reference maps for the click card: which concepts a block mentions,
  // which blocks mention a concept, and which blocks live in a channel.
  const { conceptToBlocks, channelToBlocks } = useMemo(() => {
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
    const ch2b = new Map<string, GraphItem[]>();
    for (const it of items) {
      for (const chId of it.tagIds) {
        if (!ch2b.has(chId)) ch2b.set(chId, []);
        ch2b.get(chId)!.push(it);
      }
    }
    return { blockToConcepts: b2c, conceptToBlocks: c2b, channelToBlocks: ch2b };
  }, [items, concepts, blockConceptLinks]);

  // Neo4j-style "magnet": strong, short links pull connected nodes into tight
  // clusters, while only mild repulsion keeps them from overlapping and light
  // gravity holds the whole map together. The previous strong-repulsion /
  // weak-link mix strung everything out - this flips that ratio so groups clump.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || size.w === 0) return;

    const charge = fg.d3Force("charge");
    if (charge?.strength) charge.strength(-55);
    const link = fg.d3Force("link");
    // Channel links are the structural layer: strong, with spoke length
    // scaled to the hub's size so a 90-block channel gets a proportionally
    // bigger orbit than a 5-block one (uniform distances read as random).
    // Concept links barely pull - they're context, and letting them tug
    // dragged clusters into each other. Manual edges pull hardest.
    if (link?.distance)
      link.distance((l: unknown) => {
        const gl = l as GraphLink;
        if (gl.kind === "manual") return 18;
        if (gl.kind === "concept") return 40;
        // By simulation time d3 has replaced the id string with the node.
        const target = gl.target as unknown;
        const hubDeg =
          typeof target === "object" && target
            ? (target as { deg?: number }).deg ?? 1
            : 1;
        return 14 + Math.sqrt(hubDeg) * 2.4;
      });
    if (link?.strength)
      link.strength((l: unknown) => {
        const k = (l as GraphLink).kind;
        return k === "channel" ? 0.8 : k === "manual" ? 0.7 : 0.05;
      });
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

      {/* Search: jump the camera to matching nodes, Enter cycles through. */}
      <div className="absolute right-3 top-3 z-20 flex items-center gap-2 text-xs">
        {query.trim().length >= 2 && (
          <span className="text-neutral-500">
            {matches.length === 0
              ? "no match"
              : `${(matchIdx % matches.length) + 1} / ${matches.length}`}
          </span>
        )}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches.length > 0) {
              jumpToMatch(matchIdx % matches.length);
              setMatchIdx((i) => (i + 1) % matches.length);
            } else if (e.key === "Escape") {
              setQuery("");
              setFocusId(null);
            }
          }}
          placeholder="Search the map"
          className="w-44 rounded-full border border-neutral-800 bg-neutral-900/70 px-3 py-1 text-neutral-200 placeholder:text-neutral-600 backdrop-blur focus:border-neutral-500 focus:outline-none"
        />
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
            <button
              type="button"
              onClick={() => setHideUnconnected((v) => !v)}
              className="mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-neutral-900"
            >
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-sm border ${
                  hideUnconnected
                    ? "border-neutral-300 bg-neutral-300"
                    : "border-neutral-600"
                }`}
              />
              <span
                className={hideUnconnected ? "text-neutral-100" : "text-neutral-400"}
              >
                Hide unconnected blocks
              </span>
            </button>
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
              if (!touches) return `rgba(${palette.inkRGB},0.02)`;
              return l.kind === "manual"
                ? `rgba(${palette.inkRGB},0.6)`
                : `rgba(${palette.inkRGB},0.4)`;
            }
            // All grey at rest. Concept cross-ties are the visual tangle, so
            // they stay near-invisible until you hover/focus a node.
            if (l.kind === "concept") return `rgba(${palette.inkRGB},0.03)`;
            return l.kind === "manual"
              ? `rgba(${palette.inkRGB},0.28)`
              : `rgba(${palette.inkRGB},0.1)`;
          }}
          linkWidth={(raw: unknown) => {
            const l = raw as GraphLink;
            const base =
              l.kind === "manual" ? 1.2 : l.kind === "channel" ? 0.8 : 0.5;
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
          nodeVisibility={(raw: unknown) => isNodeVisible(raw as GraphNode)}
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
              if (!isNodeVisible(n)) continue;

              // When something is active, only its neighbourhood is labelled.
              if (activeId !== null && !inActiveSet(n.id)) continue;

              const isConcept = n.type === "concept";
              const isChannel = n.type === "channel";
              const highlighted = inActiveSet(n.id);

              // Zoom fade, led earlier for well-connected nodes. Channels name
              // themselves first (they're the wayfinding layer), then concepts,
              // then blocks as you zoom in.
              const degNorm = Math.min(1, (n.deg ?? 0) / hubDeg);
              const revealLead = isChannel ? 0.2 : isConcept ? 0.35 : 0.9;
              const baseStart = isChannel ? 0.22 : isConcept ? 0.4 : 1.1;
              const baseEnd = isChannel ? 0.7 : isConcept ? 1.1 : 2.0;
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
              const maxPx = isChannel ? 26 : isConcept ? 24 : 20;
              const grow = (isChannel ? 7 : isConcept ? 6 : 5) * globalScale;
              const screenPx = Math.min(maxPx, Math.max(11, grow));
              const fontSize = screenPx / globalScale;
              ctx.font = `${
                isChannel || isConcept ? "600 " : ""
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
          const isChannel = node.type === "channel";
          const rawConceptId = isConcept
            ? node.id.replace(/^concept:/, "")
            : null;
          const conceptBlocks =
            isConcept && rawConceptId
              ? conceptToBlocks.get(rawConceptId) ?? []
              : [];
          const channelBlocks = isChannel
            ? channelToBlocks.get(node.tagIds[0]) ?? []
            : [];
          const CARD_W = 268;
          const left = Math.max(
            8,
            Math.min(selected.x + 14, size.w - CARD_W - 8)
          );
          const top = Math.max(8, Math.min(selected.y + 14, size.h - 260));
          return (
            <div
              className="pointer-events-auto absolute z-20 rounded-2xl border border-neutral-800 bg-neutral-950/90 p-4 text-xs shadow-xl backdrop-blur-xl"
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

              {isChannel ? (
                <>
                  <div
                    className="mb-1 pr-4 text-sm font-semibold"
                    style={{ color: node.color }}
                  >
                    {node.name}
                  </div>
                  <div className="mb-3 text-neutral-500">
                    {channelBlocks.length} block
                    {channelBlocks.length === 1 ? "" : "s"} in this channel
                  </div>
                  {channelBlocks.length > 0 && (
                    <ul className="mb-3 space-y-1">
                      {channelBlocks.slice(0, 6).map((b) => (
                        <li key={b.id} className="truncate">
                          <Link
                            href={`/block/${b.id}`}
                            className="text-neutral-300 hover:text-neutral-100 hover:underline"
                          >
                            {b.title || "Untitled"}
                          </Link>
                        </li>
                      ))}
                      {channelBlocks.length > 6 && (
                        <li className="text-neutral-600">
                          +{channelBlocks.length - 6} more
                        </li>
                      )}
                    </ul>
                  )}
                  {node.slug && (
                    <Link
                      href={`/channel/${node.slug}`}
                      className="inline-flex items-center rounded-full bg-neutral-100 px-3 py-1 font-medium text-neutral-900 transition-colors hover:bg-white"
                    >
                      Open channel →
                    </Link>
                  )}
                </>
              ) : isConcept ? (
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
                      className="inline-flex items-center rounded-full bg-neutral-100 px-3 py-1 font-medium text-neutral-900 transition-colors hover:bg-white"
                    >
                      Open concept →
                    </Link>
                  )}
                </>
              ) : (
                <>
                  {node.img && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={node.img}
                      alt=""
                      className="mb-2.5 h-32 w-full rounded-lg object-cover"
                    />
                  )}
                  <div className="mb-2 pr-4 text-sm font-semibold leading-snug text-neutral-100">
                    {node.name}
                  </div>
                  {node.tags.length > 0 && (
                    <div className="mb-3 flex flex-wrap gap-1">
                      {node.tags.slice(0, 4).map((t, i) => (
                        <span
                          key={t}
                          className="flex items-center gap-1.5 rounded-full bg-neutral-900 px-2 py-0.5 text-neutral-300"
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{
                              background: node.tagIds[i]
                                ? channelColor(node.tagIds[i])
                                : BLOCK_NEUTRAL,
                            }}
                          />
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <Link
                    href={`/block/${node.id}`}
                    className="inline-flex items-center rounded-full bg-neutral-100 px-3 py-1 font-medium text-neutral-900 transition-colors hover:bg-white"
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
