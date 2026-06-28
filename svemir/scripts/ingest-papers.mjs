#!/usr/bin/env node
// svemir — Step A of paper ingestion: MECHANICAL, NO AI.
//
// Reads research papers (Markdown) and loads each into Supabase as a
// `kind = 'paper'` item: metadata + abstract parsed from frontmatter, full text
// uploaded to the PRIVATE `papers` bucket, and the paper connected to its
// collection's channel. The 5-dimension facets are NOT done here — that's
// Step B (Claude Code produces paper-facets.json, then apply-facets reconciles
// them via lib/paper-facets.ts).
//
// Why a standalone .mjs: it reuses @supabase/supabase-js (already a dependency)
// with the service-role key from .env.local, runs once/locally, and never ships
// to the client. slugify is inlined to match lib/constants.ts so the script has
// zero build step.
//
// Usage (run from the svemir/ directory):
//   node scripts/ingest-papers.mjs --dry-run        # parse + report only, no DB
//   node scripts/ingest-papers.mjs                  # ingest all collections
//   node scripts/ingest-papers.mjs --collection="HCI"   # one collection (substring)
//   node scripts/ingest-papers.mjs --limit=5        # cap files per collection
//   node scripts/ingest-papers.mjs "/path/to/Markdown library"   # custom source
//
// Idempotent: a paper's storage path is deterministic (collection/file slug), so
// re-running skips papers already imported and overwrites their stored .md.

import { readdir, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createClient } from "@supabase/supabase-js";
import matter from "gray-matter";

const BUCKET = "papers";
const DEFAULT_SOURCE = path.join(os.homedir(), "Desktop", "PhD", "Markdown library");

// Every paper is connected to this shared channel (in addition to its collection
// channel), so all papers are filterable/searchable as one group — the "tag"
// that marks an item as a research paper.
const SHARED_CHANNEL = "Research Papers";

// Source files that aren't research papers (grade forms, a study proposal that
// rode along in a collection folder). Never ingested. Keyed by exact filename.
const SKIP_FILES = new Set([
  "2022_programme_template-of-the-points-earned-at-the-course-and-grade.md",
  "2022_razvoj_obrazac-za-evidenciju-osvojenih-poena-na-predmetu-i-predlog.md",
  "nd_unknown_study-proposal-potpis.md",
]);

// Agent-curated metadata fixes for papers whose PDF→Markdown conversion lost or
// garbled the byline (so the frontmatter/body author fields are junk). Authors
// here were read from each paper's real byline; `[]` means the byline was
// unrecoverable, so we show no author rather than a wrong one. Keyed by filename.
const OVERRIDES = {
  "2011_impagliazzo_utopia-participatory-design-from-scandinavia-to-the-world.md": { authors: ["Yngve Sundblad"] },
  "2017_hal_virtual-and-augmented-reality-in-architectural-design-and.md": { authors: ["Julie Milovanovic", "Guillaume Moreau", "Daniel Siret", "Francis Miguet"] },
  "2018_terms_mapping-citizens-emotions-participatory-planning-support.md": { authors: ["Jiří Pánek"] },
  "2019_internacional_barcelona-a-de.md": { authors: ["Mónica V. Sánchez-Sepúlveda", "David Fonseca-Escudero", "Jordi Franquesa-Sanchez", "Nuria Marti-Audi"], title: "Virtual Urbanism: A User-Centered Approach" },
  "2019_paper_august-in-san-diego-neuroscience-for-architecture-urbanism.md": { authors: [] },
  "2019_reality_sensory-urbanism-and-placemaking.md": { authors: [] },
  "2020_planning_digital-city-as-a-metaphor-for-new.md": { authors: [] },
  "2021_paper_behavioural-intervention-technology-in-ux-design-conceptual.md": { authors: ["Youngsoo Shin", "Chajoong Kim", "JungKyoon Yoon"] },
  "2021_states_measurement-of-trust-in-automation-a-narrative-review-and.md": { authors: [] },
  "2022_research_design-research-on-maker-office-space-based-on-user.md": { authors: ["Jiaqi Chi", "Jinqi Xu"] },
  "2025_patterns_arxiv-2507-06000v2-cs-hc-26-sep-2025.md": { authors: ["Shuning Zhang", "Hui Wang", "Xin Yi"] },
  "2021_c_computer-science-review.md": { authors: ["Maaruf Ali", "Peter S. Excell"] },
  "2021_ye_evaluating-grasping-visualizations-and-control-modes-in-a.md": { authors: ["Yuting Ye"] },
  "2021_lee_towards-augmented-reality-driven-human-city-interaction.md": { authors: ["Lik-Hang Lee"] },
};

// ── CLI args ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--"));
const opts = {};
for (const a of argv) {
  if (!a.startsWith("--")) continue;
  const [k, ...rest] = a.slice(2).split("=");
  opts[k] = rest.length ? rest.join("=") : true;
}
const DRY_RUN = Boolean(opts["dry-run"]);
const LIMIT = opts.limit ? parseInt(String(opts.limit), 10) : Infinity;
const ONLY = typeof opts.collection === "string" ? opts.collection.toLowerCase() : null;
const SOURCE_DIR = positional[0] ? expandTilde(positional[0]) : DEFAULT_SOURCE;

function expandTilde(p) {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

// ── slugify — kept identical to lib/constants.ts (source of truth) ──────────
function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── .env.local loader (no dotenv dependency) ────────────────────────────────
function loadEnvLocal(dir) {
  const p = path.join(dir, ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

// ── Frontmatter cleaning ────────────────────────────────────────────────────
// Authors/year/journal/etc. are [[wikilink]]-wrapped and sometimes empty.
function cleanWikiStr(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/\[\[|\]\]/g, "") // strip [[ ]]
    .replace(/^["']|["']$/g, "") // strip stray surrounding quotes
    .trim();
}

function cleanWikiList(v) {
  const arr = Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v];
  return arr.map(cleanWikiStr).filter((s) => s.length > 0);
}

// The PDF→Markdown conversion sometimes captures a section header, venue, or
// repository ID where authors should be. This backstop drops values that are
// clearly not person names, so cards never show junk like "Conference Paper".
// Pilot papers get exact fixes via OVERRIDES; this catches the rest at scale.
const AUTHOR_JUNK = [
  "conference paper", "full terms", "hal id", "united states", "urban planning",
  "humanities research", "study programme", "studijski program", "original research",
  "cover feature outlook", "public interest", "social psychology", "computer",
  "exploring virtual reality", "exploring collaboration patterns", "congreso internacional",
  "type original research", "study proposal",
];
function dropJunkAuthors(authors) {
  return authors.filter((a) => {
    const v = a.toLowerCase().trim();
    if (v.length < 3) return false;
    if (/https?:|issn|doi:|@/.test(v)) return false;
    if (AUTHOR_JUNK.includes(v)) return false;
    // Section-ish single phrases with no capitalized name pattern.
    if (/^(abstract|introduction|keywords|references|article|review|survey)\b/.test(v)) return false;
    return true;
  });
}

function toYear(v) {
  const n = parseInt(cleanWikiStr(v), 10);
  return Number.isFinite(n) && n >= 1500 && n <= 2200 ? n : null;
}

// Many frontmatter blocks use curly/smart quotes (authors: [“[[Name]]"]) which
// strict YAML rejects. Normalize them to straight quotes — but only inside the
// frontmatter, never the body (the abstract should keep its real punctuation).
function normalizeSmartQuotes(s) {
  return s
    .replace(/[“”„‟″‶]/g, '"')
    .replace(/[‘’‚‛′‵]/g, "'");
}

// Split a leading `--- ... ---` frontmatter block from the body, tolerating a
// BOM. Returns {fmText, body}; fmText is "" when there's no frontmatter.
function splitFrontmatter(raw) {
  const m = raw.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  return m ? { fmText: m[1], body: m[2] } : { fmText: "", body: raw };
}

function wikiTokens(s) {
  return s ? s.match(/\[\[.*?\]\]/g) ?? [] : [];
}

// Read a `**Label:** value` line from the body's uniform "## Metadata" block —
// the reliable fallback when frontmatter YAML is malformed.
function bodyField(body, label) {
  const m = body.match(new RegExp(`^\\*\\*${label}:\\*\\*\\s*(.*)$`, "im"));
  return m ? m[1].trim() : "";
}

function metadataFromBody(body) {
  const authorsRaw = bodyField(body, "Authors");
  const tokens = wikiTokens(authorsRaw);
  return {
    authors: tokens.length ? tokens : authorsRaw ? authorsRaw.split(",") : [],
    year: bodyField(body, "Year"),
    journal: bodyField(body, "Journal"),
    doi: bodyField(body, "DOI"),
  };
}

// ── Abstract extraction ─────────────────────────────────────────────────────
// Prefer the "## Abstract" section (text up to the next heading / hr). Fallback:
// first ~1500 chars of non-heading body text, flagged so we can review them.
function extractAbstract(body) {
  const lines = body.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+abstract\b/i.test(lines[i].trim())) {
      start = i + 1;
      break;
    }
  }
  if (start !== -1) {
    const out = [];
    for (let i = start; i < lines.length; i++) {
      const t = lines[i].trim();
      if (/^#{1,6}\s/.test(t)) break; // next heading ends the section
      if (/^---\s*$/.test(t)) break; // horizontal rule / fence
      out.push(lines[i]);
    }
    const text = out.join("\n").trim().replace(/^\.\s*/, "").trim();
    if (text) return { abstract: text, usedFallback: false };
  }
  const cleaned = lines
    .filter((l) => !/^#{1,6}\s/.test(l.trim())) // drop heading lines
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return { abstract: cleaned.slice(0, 1500), usedFallback: true };
}

function deriveTitle(frontTitle, body, fileBase) {
  const ft = cleanWikiStr(frontTitle);
  if (ft) return ft;
  const h1 = body.split(/\r?\n/).find((l) => /^#\s+\S/.test(l.trim()));
  if (h1) return h1.replace(/^#\s+/, "").replace(/\*+/g, "").trim();
  // Humanize the filename: "2011_impagliazzo_utopia-foo" → "Utopia foo"
  return fileBase.replace(/^[0-9]+_/, "").replace(/^[a-z]+_/i, "").replace(/[-_]+/g, " ").trim();
}

// ── Parse one .md into the row we'll insert (pure, no I/O) ──────────────────
// Frontmatter (smart-quote-normalized) is the primary source; the body's
// "## Metadata" block fills any field YAML couldn't supply, so a malformed
// frontmatter never loses a paper.
function parsePaper(raw, fileBase) {
  const { fmText, body } = splitFrontmatter(raw);

  let fm = {};
  let yamlFailed = false;
  if (fmText.trim()) {
    try {
      fm = matter(`---\n${normalizeSmartQuotes(fmText)}\n---\n`).data ?? {};
    } catch {
      yamlFailed = true;
    }
  }

  const b = metadataFromBody(body);
  let authors = cleanWikiList(fm.authors);
  if (authors.length === 0) authors = cleanWikiList(b.authors);
  authors = dropJunkAuthors(authors);
  const year = toYear(fm.year) ?? toYear(b.year);
  const journal = cleanWikiStr(fm.journal) || cleanWikiStr(b.journal);
  const doi = cleanWikiStr(fm.doi) || cleanWikiStr(b.doi);
  const title = deriveTitle(fm.title, body, fileBase);

  const { abstract, usedFallback } = extractAbstract(body);
  // True when we had to lean on the body because YAML failed or was empty.
  const metaFallback = yamlFailed || (fmText.trim() === "" && (authors.length || year || journal));
  return { title, authors, year, journal, doi, abstract, usedFallback, metaFallback: Boolean(metaFallback) };
}

// ── Inlined ensureChannelId (mirrors lib/channels.ts) ───────────────────────
async function ensureChannelId(client, rawTitle) {
  const title = rawTitle.trim();
  if (!title) return null;
  const slug = slugify(title);
  if (!slug) return null;
  const { data: inserted, error } = await client
    .from("channels")
    .insert({ title, slug })
    .select("id")
    .single();
  if (!error && inserted) return inserted.id;
  const { data: existing } = await client
    .from("channels")
    .select("id")
    .ilike("title", title)
    .maybeSingle();
  return existing?.id ?? null;
}

async function ensureBucket(client) {
  const { data: buckets, error } = await client.storage.listBuckets();
  if (error) throw new Error(`listBuckets failed: ${error.message}`);
  if (buckets?.some((b) => b.name === BUCKET)) return;
  const { error: createErr } = await client.storage.createBucket(BUCKET, {
    public: false, // PRIVATE — full text only readable via service-role + isAuthed()
  });
  if (createErr) throw new Error(`createBucket failed: ${createErr.message}`);
}

async function listCollections(sourceDir) {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
}

async function listMarkdown(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md"))
    .map((e) => e.name)
    .sort();
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  loadEnvLocal(process.cwd());

  if (!existsSync(SOURCE_DIR)) {
    console.error(`✖ Source dir not found: ${SOURCE_DIR}`);
    process.exit(1);
  }

  console.log(`\nsvemir paper ingestion (Step A — mechanical, no AI)`);
  console.log(`  source : ${SOURCE_DIR}`);
  console.log(`  mode   : ${DRY_RUN ? "DRY RUN (no Supabase writes)" : "LIVE"}`);
  if (ONLY) console.log(`  filter : collection ~ "${ONLY}"`);
  if (LIMIT !== Infinity) console.log(`  limit  : ${LIMIT} per collection`);

  let client = null;
  if (!DRY_RUN) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key) {
      console.error("✖ Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
      process.exit(1);
    }
    client = createClient(url, key);
    await ensureBucket(client);
    console.log(`  bucket : "${BUCKET}" ready (private)`);
  }

  let collections = await listCollections(SOURCE_DIR);
  if (ONLY) collections = collections.filter((c) => c.toLowerCase().includes(ONLY));
  if (collections.length === 0) {
    console.error("✖ No matching collections found.");
    process.exit(1);
  }

  // Pre-create channels once (cache ids) to avoid per-paper insert races —
  // one per collection plus the shared "Research Papers" channel.
  const channelIdByCollection = {};
  let sharedChannelId = null;
  if (!DRY_RUN) {
    for (const name of collections) {
      const id = await ensureChannelId(client, name);
      if (!id) throw new Error(`Could not ensure channel for "${name}"`);
      channelIdByCollection[name] = id;
    }
    sharedChannelId = await ensureChannelId(client, SHARED_CHANNEL);
    if (!sharedChannelId) throw new Error(`Could not ensure "${SHARED_CHANNEL}" channel`);
  }

  const totals = { inserted: 0, skipped: 0, fallback: 0, metaFallback: 0, errors: 0 };

  for (const name of collections) {
    const dir = path.join(SOURCE_DIR, name);
    const files = (await listMarkdown(dir)).slice(0, LIMIT);
    const tally = { inserted: 0, skipped: 0, fallback: 0, metaFallback: 0, errors: 0 };
    console.log(`\n▸ ${name}  (${files.length} file${files.length === 1 ? "" : "s"})`);

    for (const file of files) {
      if (SKIP_FILES.has(file)) {
        tally.skipped++;
        console.log(`    ⤫ skipped (not a paper): ${file}`);
        continue;
      }
      const fileBase = path.basename(file, ".md");
      const storagePath = `${slugify(name)}/${slugify(fileBase)}.md`;
      try {
        const raw = await readFile(path.join(dir, file), "utf8");
        const paper = parsePaper(raw, fileBase);
        // Agent-curated metadata fixes for papers with garbled bylines/titles.
        const ov = OVERRIDES[file];
        if (ov?.authors) paper.authors = ov.authors;
        if (ov?.title) paper.title = ov.title;
        if (paper.usedFallback) {
          tally.fallback++;
          console.log(`    ⚠ no ## Abstract, used fallback: ${file}`);
        }
        if (paper.metaFallback) tally.metaFallback++;

        if (DRY_RUN) {
          tally.inserted++;
          if (tally.inserted <= 2) {
            console.log(
              `    • ${paper.title}\n` +
                `        authors=${JSON.stringify(paper.authors)} year=${paper.year} ` +
                `venue=${paper.journal || "—"} doi=${paper.doi || "—"}\n` +
                `        abstract(${paper.abstract.length} chars): ${paper.abstract.slice(0, 120)}…\n` +
                `        → ${BUCKET}/${storagePath}`
            );
          }
          continue;
        }

        // Idempotency: skip if already imported (deterministic path).
        const { data: existing } = await client
          .from("items")
          .select("id")
          .eq("paper_full_text_path", storagePath)
          .maybeSingle();
        if (existing) {
          tally.skipped++;
          continue;
        }

        // Upload full text to the PRIVATE bucket (upsert so re-runs refresh it).
        const { error: upErr } = await client.storage
          .from(BUCKET)
          .upload(storagePath, Buffer.from(raw, "utf8"), {
            contentType: "text/markdown",
            upsert: true,
          });
        if (upErr) throw new Error(`upload: ${upErr.message}`);

        const { data: inserted, error: insErr } = await client
          .from("items")
          .insert({
            kind: "paper",
            title: paper.title,
            description: paper.abstract || null,
            source_name: paper.journal || null,
            source_type: "website", // satisfies the non-null column; cards branch on kind
            url: paper.doi ? `https://doi.org/${paper.doi}` : null,
            categories: [],
            paper_authors: paper.authors,
            paper_year: paper.year,
            paper_full_text_path: storagePath,
          })
          .select("id")
          .single();
        if (insErr || !inserted) throw new Error(`insert: ${insErr?.message ?? "no row"}`);

        const { error: connErr } = await client.from("connections").insert([
          { block_id: inserted.id, channel_id: channelIdByCollection[name] },
          { block_id: inserted.id, channel_id: sharedChannelId },
        ]);
        if (connErr) throw new Error(`connect: ${connErr.message}`);

        tally.inserted++;
      } catch (e) {
        tally.errors++;
        console.error(`    ✖ ${file}: ${e instanceof Error ? e.message : e}`);
      }
    }

    console.log(
      `  ${name}: inserted=${tally.inserted} skipped=${tally.skipped} ` +
        `fallback-abstract=${tally.fallback} meta-from-body=${tally.metaFallback} errors=${tally.errors}`
    );
    totals.inserted += tally.inserted;
    totals.skipped += tally.skipped;
    totals.fallback += tally.fallback;
    totals.metaFallback += tally.metaFallback;
    totals.errors += tally.errors;
  }

  console.log(
    `\n${DRY_RUN ? "[dry run] would insert" : "Done."} ` +
      `inserted=${totals.inserted} skipped=${totals.skipped} ` +
      `fallback-abstract=${totals.fallback} meta-from-body=${totals.metaFallback} errors=${totals.errors}\n`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
