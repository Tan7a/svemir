# Plan: ingest + facet the remaining ~304 papers (with the same care as the pilot)

> **How to use this file:** In a fresh chat say *"Read `PAPERS_BACKFILL_PLAN.md` and
> execute it"* (optionally name the collection/batch to start with). This document is
> self-contained — it assumes the agent has **no memory** of the pilot session.

---

## 0. TL;DR

The pilot collection ("HCI & Adaptive Interfaces", 21 papers) is fully ingested and
faceted, and all the infrastructure exists. What remains is to run the **same two-step
pipeline** over the other two collections — **AI Personalization & SLR (226)** and
**Emotional Design (78)** — *carefully*, batch by batch:

1. **Ingest** (mechanical, no AI): `node scripts/ingest-papers.mjs --collection="<name>"`
2. **Facet** (agent-driven): read each paper, assign the **5 facets** reusing the
   **canonical vocabulary**, write definitions + per-paper notes into
   `scripts/paper-facets.json`, then `node scripts/apply-facets.mjs`.

Both steps are **idempotent and resumable** — safe to run in batches across sessions.

The single most important thing: **facet-value consistency across all 330 papers.**
Reuse exact canonical strings so papers connect into one network (dedup is on
`lower(value)` per dimension). See §4.

---

## 1. Current state (the baseline — already done)

- **Migrations applied** in Supabase: `0007_papers.sql` (papers + facet tables) and
  `0008_facet_definitions_and_notes.sql` (`paper_facets.definition`,
  `paper_facet_links.note`). **No new migrations are needed** for the backfill.
- **Private storage bucket `papers`** exists (`public:false`). Full text lives only
  there; never in a column. Copyright gate = `/api/papers/[id]/content` behind
  `isAuthed()`.
- **Pilot done:** "HCI & Adaptive Interfaces" — 26 source files → 3 non-papers skipped,
  2 later deleted by the owner → **21 papers in the DB**, all faceted. **43 distinct
  facets, ~104 links**, each facet has a `definition`, each link has a `note`.
- **Shared channel** "Research Papers" is attached to every paper (plus the per-collection
  channel). The script does this automatically.
- **App features live:** paper cards (Blocks + Channels views), paper detail
  (`PaperDetail.tsx`: title→authors→meta→abstract→facets→owner-only full text, inline
  Edit/Save), clickable facet tags with counts, facet panel (`/facet/[slug]` + modal),
  facets index (`/facets`, in the top nav), grid filter (`/?facet=<slug>`).

**Verify the baseline before starting** (anon key, read-only):
```
node -e "see §9 'state check' snippet"   # expect ~21 papers, 43 facets
```

---

## 2. Scope remaining

Source root: `~/Desktop/PhD/Markdown library/` (override with a positional arg).

| Collection (folder = channel) | Files | Status |
|---|---|---|
| HCI & Adaptive Interfaces | 26 | ✅ done (21 in DB) |
| Emotional Design | 78 | ✅ done (68 in DB; 10 skipped — see SKIP_FILES) |
| **AI Personalization & SLR** | **226** | ⏳ ingested (204 in DB; 19 skipped + 3 dups merged/removed); **104/204 faceted** — resume at `2021-song-…` (path-sorted) |

**Known data-quality traps (already handled by the script, but verify per collection):**
- **Smart/curly quotes** in YAML frontmatter broke ~61 AI-collection files — handled by
  `normalizeSmartQuotes` + a body-`## Metadata` fallback. Expect `meta-from-body` > 0.
- **Junk authors** ("Conference Paper", "Humanities Research", section headers, HAL IDs) —
  the `dropJunkAuthors` filter removes obvious junk (leaves authors empty rather than
  wrong). High-value names can be recovered via `OVERRIDES` (see §5a).
- **Non-papers** that ride along in folders (grade forms, course transcripts, books,
  appendix/dataset dumps). The AI collection likely contains some
  (e.g. `*what-is-ai*` = course transcript, `*hooked*` = a book, `*appendix*`/`*dataset*`).
  These must be added to `SKIP_FILES` (see §5a).
- **~6/330 papers lack `## Abstract`** → first-1500-chars fallback, flagged
  `fallback-abstract` in the run summary. Review those.

---

## 3. The pipeline & key files (reference)

**Scripts** (`svemir/scripts/`, run from `svemir/`, read `.env.local`):
- `ingest-papers.mjs` — mechanical ingest. Flags: `--dry-run`, `--collection="<substr>"`,
  `--limit=N`, positional source dir. Contains `SKIP_FILES`, `OVERRIDES`
  (per-file `{authors?, title?}`), `dropJunkAuthors`, `SHARED_CHANNEL = "Research Papers"`.
  Idempotent per `paper_full_text_path = "<collection-slug>/<file-slug>.md"`.
- `apply-facets.mjs` — reads `paper-facets.json`, resolves each path → paper row,
  reconciles facets, writes `definition` (per facet) + `note` (per link). `--dry-run`
  matches paths + counts without writing. Idempotent.
- `paper-facets.json` — the facet data. Top-level `_definitions` map
  (`"dimension::value" → definition`) is the **canonical vocabulary source of truth**.
  Per paper: `{ aiTechniques|uxEffects|challenges|metrics|ethicalConcerns: [{v, note}] }`.

**App pieces that already consume the data** (no changes needed for backfill):
`lib/paper-facets.ts`, `lib/queries.ts` (`getFacetWithPapers`, `listFacets`,
`paperIdsForFacet`), `lib/constants.ts` (`FACET_DIMENSIONS`, `facetColor`),
`components/PaperDetail.tsx`, `components/FacetDetail.tsx`, `app/facet/[slug]/`,
`app/facets/page.tsx`, facet filter in `app/page.tsx`.

> ⚠️ `svemir/AGENTS.md`: this is a **modified Next.js** — read
> `svemir/node_modules/next/dist/docs/` before writing any new route/component. (The
> backfill needs **no** new app code, so this only matters if you extend the UI.)

---

## 4. The 5 facet dimensions — rubric + canonical-vocabulary rules

**This is the part to get right.** Facets only create value if values **recur** across
papers (that's what links them). Inconsistent naming = a broken network.

### Rules (non-negotiable)
1. **Read `_definitions` in `paper-facets.json` FIRST.** It is the controlled vocabulary.
   **Reuse an existing value verbatim** whenever a paper fits it (case-insensitive dedup,
   but match the exact casing/wording to keep the JSON clean).
2. **Add a new canonical value only for a genuinely new concept.** When you do, add its
   `_definitions["dimension::Value"]` entry in the **same edit**. Every value used MUST
   have a definition (the apply step's validation in §9 checks this).
3. **Keep values short, canonical noun phrases** (2–4 words), Title case, no trailing
   punctuation. Prefer a slightly more general value that several papers share over a
   hyper-specific one used once (singletons are fine but don't invent near-duplicates —
   e.g. don't add "Recommender system" if "Recommender systems" exists).
4. **3–7 facets per paper total**, spread across whichever dimensions genuinely apply.
   **Empty dimensions are expected** (e.g. a pure architecture paper has no `aiTechnique`).
   Never pad.
5. **Every facet carries a `note`** — one specific sentence (≤140 chars) on *how this
   paper* exhibits the facet (not a definition; that's `_definitions`).
6. When unsure between two existing values, pick the one with the **higher current
   count** (strengthens real connectors). Check counts via the state snippet in §9.

### What belongs in each dimension
- **`ai_technique`** — the AI/ML/computational method *used or studied*. Only when
  genuinely AI/ML. Examples (extend): `Collaborative filtering`, `Content-based
  recommendation`, `Hybrid recommender`, `Recommender systems`, `Machine learning`,
  `Deep learning`, `Reinforcement learning`, `Natural language processing`, `Large
  language models`, `Explainable AI (XAI)`, `Affective computing`, `Emotion recognition`,
  `Computer vision`, `Conversational agents`, `User modeling`, `Adaptive/intelligent UI`,
  `Human-AI interaction`, `Human-AI co-creation`, `Generative AI`, `Autonomous agents &
  automation`.
- **`ux_effect`** — the user-experience quality/effect the paper concerns. Examples
  (extend): `Personalization & adaptation`, `User engagement`, `Trust`, `Usability`,
  `Immersion & presence`, `Emotional response`, `Aesthetic pleasure`, `Satisfaction`,
  `Persuasion`, `Behaviour change`, `Recommendation quality`, `Transparency`, `Flow`,
  `Cognitive load`, `Sense of place`, `Experiential learning`, `Participation &
  collaboration`, `Wayfinding & spatial orientation`.
- **`challenge`** — the design/research difficulty addressed. Examples (extend): `Cold
  start`, `Data sparsity`, `Filter bubble / over-personalization`, `Scalability`,
  `Algorithmic bias`, `Privacy-preserving personalization`, `Explainability`, `Measuring
  user experience`, `Measuring emotion`, `Designing for uncertainty`, `AI
  unpredictability`, `Generalizability`, `Adapting to diverse users`, `Fragmented
  research`, `Cold evaluation`.
- **`metric`** — how the paper measures/evaluates (method or instrument). Examples
  (extend): `Accuracy / precision / recall`, `Ranking metrics (NDCG/MAP)`, `A/B testing`,
  `Click-through rate`, `Engagement metrics`, `Self-report measures`, `Emotion scales
  (SAM/PAD)`, `Facial expression analysis`, `Physiological measures`, `Eye tracking`,
  `Task performance`, `Usability evaluation`, `Qualitative interviews`, `Survey
  responses`, `Presence rating`.
- **`ethical_concern`** — the ethical/societal issue raised. Examples (extend): `Privacy`,
  `Algorithmic bias & fairness`, `Transparency`, `Filter bubbles & echo chambers`, `Data
  consent`, `User autonomy & agency`, `Behaviour manipulation`, `Emotional manipulation`,
  `Surveillance`, `Accountability`, `Inclusion & accessibility`, `Digital divide`,
  `Societal impact of AI`, `User empowerment`.

> The lists above are a **seed palette** to keep naming consistent for these two domains.
> The authoritative set is always `_definitions` — reuse from it; add to it deliberately.

---

## 5. Step-by-step procedure (per collection, batched)

Do **one collection at a time**, in **sub-batches of ~25 papers**. After each sub-batch:
apply + verify + (optionally) commit. This keeps quality high and the work resumable.

### 5a. Ingest the collection (mechanical, once per collection)

1. **Digest the collection** to spot non-papers and junk authors before writing rows.
   Use the digest snippet in §9 (`--collection` filter) to print title/keywords/
   concepts/abstract for every file. Skim for:
   - **Non-papers** (forms, transcripts, books, datasets, appendices) → add their **exact
     source filenames** to `SKIP_FILES` in `ingest-papers.mjs`.
   - **Junk/garbled authors or titles** worth fixing → add `OVERRIDES["<filename>"] =
     { authors: [...], title?: "..." }` (read the real byline from the file body, which
     usually sits just after the *second* `# Title` heading, below the `## Metadata`
     block). Recover high-value names; let `dropJunkAuthors` clear the rest.
2. **Dry-run** to confirm parsing & skips: `node scripts/ingest-papers.mjs --collection="<name>" --dry-run`
   — expect `errors=0`. Investigate any errors before going live.
3. **Live ingest:** `node scripts/ingest-papers.mjs --collection="<name>"`
   — rows created, full text uploaded to the private bucket, connected to the collection
   channel + "Research Papers". Re-runnable (skips already-imported paths).

### 5b. Produce the facets (the careful, agent-driven part)

For each sub-batch of papers:
1. Pull the **digest** for the batch (title + keywords + concepts + abstract). For
   subtle dimensions (metrics, ethical concerns) the abstract usually suffices; read more
   of the body via the source `.md` only when the abstract is thin.
2. Open `paper-facets.json`, **read `_definitions`** (current vocabulary).
3. For each paper add an entry keyed by its `paper_full_text_path`
   (`"<collection-slug>/<file-slug>.md"`) with `{v, note}` facets per §4. **Reuse**
   canonical values; **extend** `_definitions` for genuinely new ones (same edit).
4. Keep the entry order grouped by collection for readability.

### 5c. Apply + verify the batch

```
node scripts/apply-facets.mjs --dry-run   # matches all paths? unmatched=0 for live papers
node scripts/apply-facets.mjs             # writes facets + definitions + notes
```
Then run the verification snippet (§9): connector counts went up, no facet lacks a
definition, anon RLS can read definitions/notes. Spot-check one new `/facet/[slug]` panel.

---

## 6. Batching & resumability

- **Resumable by design:** ingest skips imported paths; `apply-facets` re-reconciles
  whatever is in the JSON (idempotent). You can stop after any sub-batch and resume later.
- **Suggested order:** Emotional Design (78) first — smaller, sharpens the affect/emotion
  vocabulary — then AI Personalization & SLR (226) in ~9 sub-batches of ~25.
- **Track progress** with a checklist at the top of `paper-facets.json`'s `_README`
  (e.g. "Emotional Design: 50/78 faceted") or a scratch checklist, so a later session
  knows where to resume.
- **Effort is real:** ~304 papers × careful facets + notes is large. Expect this to span
  **multiple sessions**. That's fine — each sub-batch is self-contained.

### Optional acceleration (only if the user opts into multi-agent / "ultracode")
Parallelize faceting **without** fragmenting the vocabulary:
1. **Phase A (serial):** extend `_definitions` up front for the whole collection from the
   digests — fix the controlled vocabulary first.
2. **Phase B (parallel):** fan out one agent per sub-batch to produce `{v, note}` facets
   **strictly against the fixed vocabulary** (instruct: do not coin new values; flag gaps).
3. **Phase C (serial):** reconcile — dedupe near-duplicate values, resolve flagged gaps,
   then `apply-facets`. This preserves network consistency that naive parallelism breaks.

---

## 7. Verification & quality gates (per batch + final)

Per batch:
- `node scripts/apply-facets.mjs --dry-run` → `unmatched=0` for live papers (a path typo
  or a deleted paper shows here).
- State snippet (§9): every used facet has a `definition`; `note` count == link count;
  connector facets (paper_count > 1) increasing.
- `cd svemir && npx tsc --noEmit && npx eslint` clean (only if you touched app code).
- Spot-check 1–2 `/facet/[slug]` panels and the `/facets` index in the running app.

Final (after all collections):
- Total papers ≈ 330 minus skipped non-papers minus any deleted.
- `/facets` shows a coherent, **not bloated** vocabulary (watch for accidental
  near-duplicate values — merge by editing the JSON to the canonical value and re-applying).
- Run `/security-review` on any access-control changes (none expected for a pure backfill).
- Copyright gate still holds: `/api/papers/[id]/content` → 403 when signed out.

---

## 8. Edge cases & decisions to confirm with Tanja up front

1. **The 2 deleted pilot papers** ("August in San Diego: Neuroscience…",
   "Of Streets and Squares") — restore them (`ingest --collection="HCI"` re-adds only the
   missing two, then `apply-facets`) or leave deleted? Their facet entries are still in
   the JSON.
2. **Non-papers in the new collections** — confirm the policy: skip silently, or surface a
   list for Tanja to approve before skipping. (Recommend: surface the candidate skip-list
   for a quick yes/no, like the pilot.)
3. **Author recovery depth** — recover only high-value bylines via `OVERRIDES`, or attempt
   all? (Recommend: filter-only for the 304; OVERRIDES for obvious, easy wins. Authors are
   secondary to facets.)
4. **Notes for thin/junk papers** — keep brief honest notes, or skip faceting papers that
   are too degraded to read? (Recommend: facet what's defensible; skip truly unreadable.)
5. **Scope of a session** — how many sub-batches per session / how much token budget.

---

## 9. Command cheat-sheet (copy/paste)

All run from `svemir/`. Temp scripts go in `scripts/_*-tmp.mjs` and are deleted after use;
they load `.env.local` the same way the real scripts do.

**Ingest:**
```
node scripts/ingest-papers.mjs --collection="Emotional Design" --dry-run
node scripts/ingest-papers.mjs --collection="Emotional Design"
node scripts/ingest-papers.mjs --collection="AI Personalization"
```

**Facets:**
```
node scripts/apply-facets.mjs --dry-run
node scripts/apply-facets.mjs
```

**Digest a collection** (title/keywords/concepts/abstract per file — basis for faceting):
adapt the pilot digest: a `scripts/_digest-tmp.mjs` that `readdir`s the collection folder,
`gray-matter`-parses frontmatter (normalize smart quotes), extracts the `## Abstract`, and
prints a compact block per file. (See the pilot session's digest; same shape.)

**State check** (anon key — papers, facets, connectors, missing definitions):
```js
// scripts/_state-tmp.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
for (const l of readFileSync(".env.local","utf8").split(/\r?\n/)){const m=l.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);if(m&&process.env[m[1]]===undefined){let v=m[2];if((v[0]==='"'&&v.endsWith('"'))||(v[0]==="'"&&v.endsWith("'")))v=v.slice(1,-1);process.env[m[1]]=v;}}
const c=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL.trim(),process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.trim());
const {count:papers}=await c.from("items").select("*",{count:"exact",head:true}).eq("kind","paper");
const {count:links}=await c.from("paper_facet_links").select("*",{count:"exact",head:true});
const {count:notes}=await c.from("paper_facet_links").select("*",{count:"exact",head:true}).not("note","is",null);
const {data:f}=await c.from("paper_facets").select("dimension,value,paper_count,definition").order("paper_count",{ascending:false});
console.log(`papers=${papers} links=${links} notes=${notes} facets=${f.length} missingDefs=${f.filter(x=>!x.definition).length}`);
console.log("top connectors:", f.filter(x=>x.paper_count>1).slice(0,15).map(x=>`${x.paper_count}× ${x.value}`).join(" | "));
```

**JSON sanity** (every used value has a definition — run before apply):
```
node -e "const j=require('./scripts/paper-facets.json');const D={aiTechniques:'ai_technique',uxEffects:'ux_effect',challenges:'challenge',metrics:'metric',ethicalConcerns:'ethical_concern'};let miss=0;for(const[k,v]of Object.entries(j)){if(k[0]==='_')continue;for(const[dk,dim]of Object.entries(D))for(const e of v[dk]||[]){const val=typeof e==='string'?e:e.v;if(!j._definitions[dim+'::'+val]){console.log('MISSING DEF:',dim+'::'+val);miss++;}}}console.log('missing defs:',miss);"
```

---

## 10. Definition of done

- All real papers in both collections are `kind='paper'` rows (private full text in the
  `papers` bucket), connected to their collection channel + "Research Papers".
- Every paper has facets across the relevant dimensions; **every facet value has a
  definition; every link has a note.**
- The facet vocabulary is coherent (no near-duplicate values), and the network shows
  meaningful cross-collection connectors (e.g. "Personalization & adaptation",
  "Trust", "Privacy" spanning HCI + AI + Emotional Design).
- `/facets`, `/facet/[slug]`, the grid filter, and paper detail all render the new data;
  copyright gate intact.
- (Optional, separate task) **Phase 3 visual facet graph** — a "Research" mode in the
  graph drawing papers linked by shared facets, colored by dimension via `facetColor`
  (already in `lib/constants.ts`). Cloneable from `KnowledgeGraph.tsx`. Not required for
  the backfill, but the natural finale once the corpus is complete.
