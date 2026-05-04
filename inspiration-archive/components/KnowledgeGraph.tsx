"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { ComponentType } from "react";

// react-force-graph-2d's TypeScript generics don't survive next/dynamic, so
// we treat it as a permissive component and rely on our own GraphNode/GraphLink
// types inside callbacks.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-zinc-500">
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

type Props = { items: GraphItem[] };

type GraphNode = {
  id: string;
  name: string;
  category: string | null;
  tags: string[];
};

type GraphLink = {
  source: string;
  target: string;
  value: number;
};

const MAX_EDGES = 4000;
const LABEL_ZOOM_THRESHOLD = 1.4;
const COMMON_TAG_FRACTION = 0.1; // tags on >10% of items are "too common" to be meaningful edges

export default function KnowledgeGraph({ items }: Props) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<{
    d3Force: (name: string) => { strength?: (n: number) => unknown; distance?: (n: number) => unknown } | undefined;
    zoomToFit?: (ms?: number, padding?: number) => void;
  } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [minOverlap, setMinOverlap] = useState(2);
  const [hideCommon, setHideCommon] = useState(true);

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

  const { tagFrequency, commonTagIds } = useMemo(() => {
    const freq = new Map<string, number>();
    items.forEach((i) =>
      i.tagIds.forEach((t) => freq.set(t, (freq.get(t) ?? 0) + 1))
    );
    const threshold = Math.max(50, items.length * COMMON_TAG_FRACTION);
    const common = new Set<string>();
    freq.forEach((count, id) => {
      if (count > threshold) common.add(id);
    });
    return { tagFrequency: freq, commonTagIds: common };
  }, [items]);

  const data = useMemo<{ nodes: GraphNode[]; links: GraphLink[] }>(() => {
    const nodes: GraphNode[] = items.map((i) => ({
      id: i.id,
      name: i.title,
      category: i.category,
      tags: i.tagNames,
    }));

    // Filter each item's tag set to remove the "noisy" common tags
    const meaningfulTags = items.map((i) => {
      const filtered = hideCommon
        ? i.tagIds.filter((t) => !commonTagIds.has(t))
        : i.tagIds;
      return new Set(filtered);
    });

    const candidates: GraphLink[] = [];
    for (let i = 0; i < items.length; i++) {
      const a = meaningfulTags[i];
      if (a.size === 0) continue;
      for (let j = i + 1; j < items.length; j++) {
        const b = meaningfulTags[j];
        if (b.size === 0) continue;
        let overlap = 0;
        for (const t of b) if (a.has(t)) overlap++;
        if (overlap >= minOverlap) {
          candidates.push({
            source: items[i].id,
            target: items[j].id,
            value: overlap,
          });
        }
      }
    }

    // Cap to highest-weight edges to keep render fast
    candidates.sort((a, b) => b.value - a.value);
    const links = candidates.slice(0, MAX_EDGES);
    return { nodes, links };
  }, [items, minOverlap, hideCommon, commonTagIds]);

  // Tune force simulation for spreading the graph out more
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || size.w === 0) return;
    const charge = fg.d3Force("charge");
    if (charge?.strength) charge.strength(-90);
    const link = fg.d3Force("link");
    if (link?.distance) link.distance(60);
    // Re-fit after simulation has had time to settle
    const t = setTimeout(() => fg.zoomToFit?.(400, 80), 1500);
    return () => clearTimeout(t);
  }, [data, size.w]);

  return (
    <div ref={containerRef} className="relative h-[calc(100vh-4rem)] w-full">
      <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
        <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-white/60 bg-white/80 px-4 py-2 text-xs text-zinc-700 backdrop-blur-md shadow-sm">
          <label className="flex items-center gap-1.5">
            <span className="text-zinc-500">Min shared tags</span>
            <select
              value={minOverlap}
              onChange={(e) => setMinOverlap(Number(e.target.value))}
              className="rounded border border-zinc-300 bg-white px-1.5 py-0.5"
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={hideCommon}
              onChange={(e) => setHideCommon(e.target.checked)}
            />
            <span>Ignore common tags ({commonTagIds.size})</span>
          </label>
          <span className="text-zinc-400">·</span>
          <span className="text-zinc-500">
            {data.nodes.length} nodes · {data.links.length} edges
          </span>
          <span className="text-zinc-400">·</span>
          <span className="text-zinc-400">scroll = zoom · drag = pan</span>
        </div>
      </div>
      {size.w > 0 && size.h > 0 && (
        <ForceGraph2D
          ref={fgRef}
          graphData={data}
          width={size.w}
          height={size.h}
          backgroundColor="#FBF8F4"
          nodeAutoColorBy="category"
          nodeRelSize={4}
          minZoom={0.2}
          maxZoom={8}
          warmupTicks={20}
          cooldownTicks={150}
          enableNodeDrag={false}
          nodeLabel={(raw: unknown) => {
            const node = raw as GraphNode;
            const tagsToShow = node.tags.slice(0, 12);
            return `<div style="background:#111;color:#fff;padding:8px 12px;border-radius:8px;font-size:12px;max-width:280px;line-height:1.4"><div style="font-weight:600;margin-bottom:4px">${escapeHtml(node.name)}</div>${tagsToShow.length > 0 ? `<div style="opacity:.7;font-size:11px">${tagsToShow.map((t) => "#" + escapeHtml(t)).join(" ")}${node.tags.length > tagsToShow.length ? " …" : ""}</div>` : ""}</div>`;
          }}
          linkColor={() => "rgba(0,0,0,0.08)"}
          linkWidth={(raw: unknown) => {
            const l = raw as GraphLink;
            return Math.min(0.5 + l.value * 0.4, 3);
          }}
          onNodeClick={(raw: unknown) => {
            const node = raw as GraphNode;
            router.push(`/item/${node.id}`);
          }}
          nodeCanvasObjectMode={() => "after"}
          nodeCanvasObject={(
            raw: unknown,
            ctx: CanvasRenderingContext2D,
            globalScale: number
          ) => {
            const node = raw as GraphNode & { x?: number; y?: number };
            if (node.x === undefined || node.y === undefined) return;
            // Hide labels at low zoom so the graph stays readable when zoomed out
            if (globalScale < LABEL_ZOOM_THRESHOLD) return;
            // World-space font: stays a constant on-screen size at any zoom
            const fontSize = 4;
            ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
            ctx.fillStyle = "#1f2937";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            const label =
              node.name.length > 36 ? node.name.slice(0, 34) + "…" : node.name;
            ctx.fillText(label, node.x, node.y + 6);
          }}
        />
      )}
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
