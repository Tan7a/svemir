#!/usr/bin/env node
// svemir — Step B (apply): write the agent-produced facets into Supabase.
//
// Reads scripts/paper-facets.json (keyed by items.paper_full_text_path),
// resolves each to its paper row, and reconciles its 5-dimension facets into
// paper_facets / paper_facet_links. Mirrors lib/paper-facets.ts (inlined here so
// this standalone .mjs needs no TypeScript build). Idempotent: re-running with
// edited facets produces a clean set and refreshes prevalence counts.
//
// Usage (from svemir/):  node scripts/apply-facets.mjs   [--dry-run]

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DRY_RUN = process.argv.includes("--dry-run");

const DIMENSION_BY_KEY = {
  aiTechniques: "ai_technique",
  uxEffects: "ux_effect",
  challenges: "challenge",
  metrics: "metric",
  ethicalConcerns: "ethical_concern",
};

function slugify(input) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function escapeLike(v) {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function loadEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

// ── ensureFacet — insert-then-lookup on (dimension, lower(value)) ───────────
// Also writes the canonical `definition` (what the tag means) when provided.
async function ensureFacet(client, dimension, rawValue, definition) {
  const value = rawValue.trim();
  if (!value) return null;

  let id = null;
  const { data: existing } = await client
    .from("paper_facets")
    .select("id")
    .eq("dimension", dimension)
    .ilike("value", escapeLike(value))
    .maybeSingle();
  if (existing) id = existing.id;

  if (!id) {
    const base = slugify(`${dimension} ${value}`) || slugify(dimension) || "facet";
    for (let attempt = 0; attempt < 6 && !id; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const { data: inserted, error } = await client
        .from("paper_facets")
        .insert({ dimension, value, slug })
        .select("id")
        .single();
      if (!error && inserted) {
        id = inserted.id;
        break;
      }
      const { data: race } = await client
        .from("paper_facets")
        .select("id")
        .eq("dimension", dimension)
        .ilike("value", escapeLike(value))
        .maybeSingle();
      if (race) id = race.id;
    }
  }

  if (id && definition) {
    await client.from("paper_facets").update({ definition }).eq("id", id);
  }
  return id;
}

async function refreshFacetCounts(client, facetIds) {
  for (const id of new Set(facetIds)) {
    const { count } = await client
      .from("paper_facet_links")
      .select("*", { count: "exact", head: true })
      .eq("facet_id", id);
    await client.from("paper_facets").update({ paper_count: count ?? 0 }).eq("id", id);
  }
}

async function reconcilePaperFacets(client, paperId, facets, definitions) {
  const seen = new Set();
  const rows = []; // { facet_id, note }
  for (const [key, dimension] of Object.entries(DIMENSION_BY_KEY)) {
    for (const entry of facets[key] ?? []) {
      // Accept a plain string or { v, note }.
      const value = (typeof entry === "string" ? entry : entry.v ?? "").trim();
      if (!value) continue;
      const note = typeof entry === "string" ? null : entry.note ?? null;
      const dedup = `${dimension}::${value.toLowerCase()}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      const def = definitions[`${dimension}::${value}`] ?? null;
      const id = await ensureFacet(client, dimension, value, def);
      if (id) rows.push({ facet_id: id, note });
    }
  }
  const { data: prev } = await client
    .from("paper_facet_links")
    .select("facet_id")
    .eq("paper_id", paperId);
  const prevIds = (prev ?? []).map((r) => r.facet_id);

  await client.from("paper_facet_links").delete().eq("paper_id", paperId);
  if (rows.length > 0) {
    await client
      .from("paper_facet_links")
      .upsert(
        rows.map((r) => ({ paper_id: paperId, facet_id: r.facet_id, note: r.note })),
        { onConflict: "paper_id,facet_id" }
      );
  }
  await refreshFacetCounts(client, [...rows.map((r) => r.facet_id), ...prevIds]);
  return rows.length;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error("✖ Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }
  const client = createClient(url, key);

  // Preflight: facet tables must exist (migration 0007).
  const { error: tblErr } = await client.from("paper_facets").select("id").limit(1);
  if (tblErr) {
    console.error(`✖ paper_facets not reachable — has migration 0007 been applied? (${tblErr.message})`);
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(path.join("scripts", "paper-facets.json"), "utf8"));
  const definitions = raw._definitions ?? {};
  const entries = Object.entries(raw).filter(([k]) => !k.startsWith("_"));
  console.log(`\nApplying facets for ${entries.length} papers${DRY_RUN ? " (DRY RUN)" : ""}…\n`);

  let matched = 0,
    unmatched = 0,
    totalLinks = 0;
  for (const [fullTextPath, facets] of entries) {
    const { data: item } = await client
      .from("items")
      .select("id, title")
      .eq("kind", "paper")
      .eq("paper_full_text_path", fullTextPath)
      .maybeSingle();
    if (!item) {
      unmatched++;
      console.log(`  ⚠ no paper row for ${fullTextPath}`);
      continue;
    }
    const count = Object.entries(DIMENSION_BY_KEY).reduce(
      (s, [k]) => s + (facets[k]?.length ?? 0),
      0
    );
    if (DRY_RUN) {
      console.log(`  • ${(item.title || "").slice(0, 52)} → ${count} facets`);
      matched++;
      totalLinks += count;
      continue;
    }
    const linked = await reconcilePaperFacets(client, item.id, facets, definitions);
    console.log(`  • ${(item.title || "").slice(0, 52)} → ${linked} facets`);
    matched++;
    totalLinks += linked;
  }

  console.log(`\nmatched=${matched} unmatched=${unmatched} totalFacetLinks=${totalLinks}`);
  if (!DRY_RUN) {
    const { count: facetCount } = await client
      .from("paper_facets")
      .select("*", { count: "exact", head: true });
    console.log(`distinct facets now in paper_facets: ${facetCount}\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
