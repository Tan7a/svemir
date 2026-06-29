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
  // HCI & Adaptive Interfaces (pilot)
  "2022_programme_template-of-the-points-earned-at-the-course-and-grade.md",
  "2022_razvoj_obrazac-za-evidenciju-osvojenih-poena-na-predmetu-i-predlog.md",
  "nd_unknown_study-proposal-potpis.md",
  // Emotional Design — non-papers (OCR-only stubs, a book, a worksheet, an
  // annual-review volume's front-matter) + near-duplicate re-exports.
  "2015_unknown_positive-design-reference-guide.md", // OCR-only stub, no text
  "nd_unknown_1992-cultural-variations-in-emotion-untitled.md", // OCR-only stub
  "nd_unknown_ghostscript-wrapper-for-c-documents-and-settings-avm.md", // OCR stub; Norman's "Emotional Design" book
  "2016_unknown_starter-questions-for-user-research.md", // UX-research worksheet, not a paper
  "2011_unknown_the-emotions-a-philosophical-introduction.md", // a book (Deonna & Teroni)
  "2016_wiederhol_annual-review-of-cybertherapy-and-telemedicine-being.md", // annual-review volume front-matter
  "2010_design_arxiv-2010-03046v1-cs-hc-6-oct-2020-2.md", // dup of the non-"-2" arXiv file
  "2020_unknown_article-do-products-respond-to-user-desires-a-case-study-2.md", // dup of non-"-2"
  "2013_mara_unconscious-human-behavior-at-visceral-level-of-emotional-2.md", // dup; keep fuller-titled non-"-2"
  "2002_project_pleasure-with-products-design-based-on-kansei.md", // dup of 1997_lee (real author) Kansei paper
  // AI Personalization & SLR — non-papers + duplicates (content-verified by abstract fingerprint).
  "1927_unknown_what-is-ai.md", // Elements-of-AI course transcript, not a paper
  "2014_unknown_hooked-how-to-build-habit-forming-products.md", // the book (OCR stub)
  "2015_outcomes_appendix-a-dataset-of-70-ai-ux-personalisation-studies.md", // dataset/appendix table
  "2016_covington_deep-neural-networks-for-youtube-recommendations-2.md", // dup
  "2016_interfaces_how-much-information-effects-of-transparency-on-trust-in-an-2.md", // dup
  "2018_todi_familiarisation-restructuring-layouts-with-visual-learning-2.md", // dup
  "2019_millecamp_to-explain-or-not-to-explain-the-effects-of-personal-2.md", // dup
  "2020_haig_a-long-term-evaluation-of-adaptive-interface-design-for-2.md", // dup
  "2020_sundar_rise-of-machine-agency-a-framework-for-studying-the-2.md", // dup
  "2020_words_progressive-disclosure-when-why-and-how-do-users-want-2.md", // dup
  "2021_liang_interactive-music-genre-exploration-with-visualization-and-2.md", // dup
  "2022_qian_scalar-authoring-semantically-adaptive-augmented-reality-2.md", // dup
  "2023_alipour_toward-changing-users-behavior-with-emotion-based-adaptive-2.md", // dup
  "2024_costaa_towards-an-ai-driven-user-interface-design-for-web-2.md", // dup
  "2018_transparency_explanations-as-mechanisms-for-supportingalgorithmic.md", // dup of 2018_rader
  "2019_library_context-aware-online-adaptation-of-mixed-reality-interfaces.md", // dup of 2019_lindlbauer
  "2019_zhang_international-journal-of-human-computer-studies.md", // dup of 2019_zhang_proactive-vs-reactive
  "2021_unknown_visual-textual-or-hybrid-the-effect-of-user-expertise-on.md", // dup of 2021_szymanski
  "2018_hal_using-user-emotions-to-trigger-ui-adaptation.md", // dup of 2025_alpes (keep the 2025 version)
  // Cross-collection duplicates: these papers already live in another collection
  // (kept + faceted there) and were merged into the AI channel; never re-ingest the AI copy.
  "2007_desmet_framework-of-product-experience.md", // == emotional-design/2007_unknown_framework-of-product-experience
  "2020_yang_re-examining-whether-why-and-how-human-ai-interaction-is.md", // == hci copy (note: also the kept HCI filename; harmless — already ingested)
  "2019_version_todi-kashyap-jokinen-jussi-luyten-kris-oulasvirta-antti.md", // == 2019_luyten (same paper; this copy had only boilerplate abstract)
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
  // ── Emotional Design — bylines confirmed from each paper's body ──
  "1985_psychology_patterns-of-cognitive-appraisal-in-emotion.md": { authors: ["Craig A. Smith", "Phoebe C. Ellsworth"] },
  "1998_vol_human-factors-for-pleasure-in-product-use.md": { authors: ["Patrick W. Jordan"] },
  "2011_lisbo_personas-and-user-centered-design-how-can-personas-benefit.md": { authors: ["Tomasz Miaskiewicz", "Kenneth A. Kozar"] },
  "nd_unknown_2003-unknown-keltnerhaidt2003approaching-awepub028.md": { authors: ["Dacher Keltner", "Jonathan Haidt"], title: "Approaching Awe, a Moral, Spiritual, and Aesthetic Emotion" },
  // Title-only fixes (filename/template titles → the paper's real title from its body).
  "2010_design_arxiv-2010-03046v1-cs-hc-6-oct-2020.md": { title: "Emotional Design in Human Factors and Ergonomics" },
  "2018_paper_paper-title-use-style-paper-title.md": { title: "Emotional Design on User Experience-based Development System" },
  "2019_vallverdu_2019-emotional-machines-paper-pdf.md": { title: "Emotional Machines" },
  "nd_radovanovic_tanja-radovanovic-emotional-design-in-digital-user.md": { title: "Emotional Design in Digital User Experience" },
  "2016_harmon-jones1_research-article-the-discrete-emotions-questionnaire-a-new.md": { title: "The Discrete Emotions Questionnaire: A New Tool for Measuring State Self-Reported Emotions" },
  "2022_copernicus_semantic-scholar-114356271-psychology-of-objects-and-their.md": { title: "Psychology of Objects and Their Interaction with Our Culture and Society" },
  // Author-clears: the only surviving "author" is an institution/place fragment — show none.
  "2013_schem_using-a-simulated-environment-to-investigate-experiences.md": { authors: [] },
  "2017_media_emotional-design-in-web-interfaces.md": { authors: [] },
  "2021_geodesicas_collaborative-emotional-mapping-as-a-tool-for-urban.md": { authors: [] },
  // ── AI Personalization & SLR — titles/bylines recovered from each paper's body (frontmatter held the journal name or an arXiv id) ──
  "2018_b_international-journal-of-human-computer-studies.md": { title: "Moodplay: Interactive Music Recommendation Based on Artists' Mood Similarity", authors: ["Ivana Andjelkovic", "Denis Parra", "John O'Donovan"] },
  "2020_article_turkish-journal-of-computer-and-mathematics-education-vol.md": { title: "The Trend of Published Literature on User Experience (UX) Evaluation: A Bibliometric Analysis" },
  "2020_b_computers-in-human-behavior.md": { title: "Customer Experiences in the Age of Artificial Intelligence", authors: ["Nisreen Ameen", "Ali Tarhini", "Alexander Reppel", "Amitabh Anand"] },
  "2021_b_pattern-recognition-letters.md": { title: "Deep Learning for Emotion Driven User Experiences", authors: ["Carmen Bisogni", "Lucia Cascone", "Aniello Castiglione", "Ignazio Passero"] },
  "2023_b_international-journal-of-human-computer-studies.md": { title: "Predicting the Need for XAI from High-Granularity Interaction Data", authors: ["Vagner Figueredo de Santana", "Ana Fucs", "Vinícius Segura", "Daniel Brugnaro de Moraes", "Renato Cerqueira"] },
  "2024_ai_arxiv-2402-06089v2-cs-hc-13-feb-2024.md": { title: "AI Assistance for UX: A Literature Review Through Human-Centered AI" },
  "2024_b_computers-and-education-artificial-intelligence.md": { title: "Large Language Models Meet User Interfaces: The Case of Provisioning Feedback", authors: ["Stanislav Pozdniakov", "Jonathan Brazil", "Solmaz Abdi", "Aneesha Bakharia", "Shazia Sadiq", "Dragan Gašević", "Paul Denny", "Hassan Khosravi"] },
  "2024_khamaj_alexandria-engineering-journal.md": { title: "Real-Time Personalized User Interface Adaptation Using Reinforcement Learning", authors: ["Abdulrahman Khamaj", "Abdulelah M. Ali"] },
  "2006_technology_user-experience-a-research-agenda.md": { authors: ["Marc Hassenzahl", "Noam Tractinsky"] },
  "2024_10-1109-access-2024_toward-an-interactive-reading-experience-deep-learning.md": { authors: ["Jayasankar Santhosh", "Akshay Palimar Pai", "Shoya Ishimaru"] },
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
  "type original research", "study proposal", "emotional design",
];
function dropJunkAuthors(authors) {
  return authors.filter((a) => {
    const v = a.toLowerCase().trim();
    if (v.length < 3) return false;
    if (/https?:|issn|doi:|@/.test(v)) return false;
    if (AUTHOR_JUNK.includes(v)) return false;
    // "<Topic> View project" — a ResearchGate PDF-export artifact, never a name.
    if (/\bview project\b/.test(v)) return false;
    if (/^hal id/.test(v)) return false;
    // Institutions, venues, repositories, and indexers misread as author names.
    // Person names don't contain these tokens, so dropping them is safe.
    if (/\b(universit|college|institute|school of|faculty|department|scholar works|copernicus|indexing|semantic scholar|researchgate|symposium|proceedings|conference|journal|review|sciences|ergonomics|telemedicine|cybertherapy|cartographic|gesture recognition|human-computer systems|backgrounds|geod[eé]sica|ci[eê]ncia|woctine|user modeling|user-adapted|industrie)/.test(v)) return false;
    // Section-ish single phrases with no capitalized name pattern.
    if (/^(abstract|introduction|keywords|references|article|review|survey|original (paper|research|article)|research article)\b/.test(v)) return false;
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
