import { STOPWORDS } from "./stopwords";

/**
 * Local, no-AI concept extraction.
 *
 * Given a block's text, returns the most salient terms/phrases it mentions -
 * single words and 2-3 word phrases - using RAKE-style candidate extraction
 * (split on stopwords/punctuation, keep the runs in between) plus a frequency
 * score. Nothing leaves the machine; no LLM, no embeddings, no network.
 *
 * Pure function - no I/O, no external calls - so it's trivially testable, the
 * same contract as lib/suggest.ts. Corpus-level thresholds (document frequency,
 * "too common" pruning) are applied by the caller (the server action), because
 * those need the whole archive, not one document.
 */

export type RawTermDoc = {
  title: string;
  description?: string | null;
  body_text?: string | null;
};

export type ExtractedTerm = {
  /** display surface form, lowercased, e.g. "knowledge graph" */
  term: string;
  /** canonical dedup key (singularized), e.g. "graphs" and "graph" → "graph" */
  matchKey: string;
  /** occurrences of this term within the document */
  count: number;
  /** 1 = single word, 2 = bigram, 3 = trigram */
  ngram: 1 | 2 | 3;
  /** term frequency within the document (count / non-stopword token count) */
  tf: number;
};

export type ExtractOptions = {
  /** cap returned terms (top by salience). Default 12. */
  maxTerms?: number;
  /** longest phrase to emit. Default 3. */
  maxNgram?: 1 | 2 | 3;
  /** cap how much body_text is scanned, for very long pages. Default 20000. */
  bodyCharLimit?: number;
};

const WORD_MIN_LEN = 3;

// A block's title + description are curated and far more topical than its scraped
// body (which carries nav chrome, captions, boilerplate). Counting head terms
// this many times over makes genuinely on-topic terms win the top-N, instead of
// whatever recurs most in the page body.
const HEAD_WEIGHT = 3;

/**
 * Conservative singularization for the dedup key. Deliberately NOT a Porter
 * stemmer - we want human-readable concepts, so we only fold obvious plurals
 * and leave everything else alone.
 */
function singularizeWord(w: string): string {
  if (w.length <= 3) return w; // "ai", "css", "api"-ish short tokens left alone
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y"; // stories→story
  // Drop "es" only after a true sibilant that genuinely needs it. NOT plain
  // "-ses" - that wrongly turns "databases"→"databas" (it's database+"s").
  if (
    w.endsWith("sses") || // classes→class, processes→process
    w.endsWith("ches") || // churches→church
    w.endsWith("shes") || // dishes→dish
    w.endsWith("xes") // boxes→box
  ) {
    return w.slice(0, -2);
  }
  if (w.endsWith("ss")) return w; // class, css, glass - keep
  if (w.endsWith("s") && !w.endsWith("us") && !w.endsWith("is")) {
    return w.slice(0, -1); // graphs→graph, databases→database, cases→case
  }
  return w;
}

function canonicalize(phrase: string): string {
  return phrase.split(" ").map(singularizeWord).join(" ");
}

/**
 * Tokenize one text segment into RAKE-style phrase runs. Lowercases; keeps
 * letters, digits, spaces and intra-word hyphens; every other character (and
 * every stopword, too-short word, or pure number) ends the current run.
 */
function toPhrases(raw: string): { phrases: string[][]; tokenCount: number } {
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " | ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = normalized.split(" ");
  const phrases: string[][] = [];
  let current: string[] = [];
  let tokenCount = 0;

  const flush = () => {
    if (current.length) phrases.push(current);
    current = [];
  };

  for (const tok of tokens) {
    if (tok === "" || tok === "|") {
      flush();
      continue;
    }
    const word = tok.replace(/^-+|-+$/g, "");
    if (
      !word ||
      word.length < WORD_MIN_LEN ||
      STOPWORDS.has(word) ||
      /^[0-9]+$/.test(word)
    ) {
      flush();
      continue;
    }
    current.push(word);
    tokenCount++;
  }
  flush();
  return { phrases, tokenCount };
}

export function extractTerms(
  doc: RawTermDoc,
  opts: ExtractOptions = {}
): ExtractedTerm[] {
  const maxTerms = opts.maxTerms ?? 12;
  const maxNgram = opts.maxNgram ?? 3;
  const bodyLimit = opts.bodyCharLimit ?? 20000;

  // Head (title + description) and body are tokenized separately so head terms
  // can be counted HEAD_WEIGHT times over - the core of the on-topic fix.
  const head = toPhrases(`${doc.title ?? ""}. ${doc.description ?? ""}`);
  const body = toPhrases((doc.body_text ?? "").slice(0, bodyLimit));

  // Emit unigrams + n-grams from every run, counting (weighted) occurrences.
  const counts = new Map<string, { count: number; ngram: 1 | 2 | 3 }>();
  const bump = (parts: string[], n: 1 | 2 | 3, weight: number) => {
    const term = parts.join(" ");
    const ex = counts.get(term);
    if (ex) ex.count += weight;
    else counts.set(term, { count: weight, ngram: n });
  };
  const emit = (phrases: string[][], weight: number) => {
    for (const phrase of phrases) {
      for (let i = 0; i < phrase.length; i++) {
        bump([phrase[i]], 1, weight);
        if (maxNgram >= 2 && i + 1 < phrase.length) {
          bump([phrase[i], phrase[i + 1]], 2, weight);
        }
        if (maxNgram >= 3 && i + 2 < phrase.length) {
          bump([phrase[i], phrase[i + 1], phrase[i + 2]], 3, weight);
        }
      }
    }
  };
  emit(head.phrases, HEAD_WEIGHT);
  emit(body.phrases, 1);

  const denom = Math.max(head.tokenCount * HEAD_WEIGHT + body.tokenCount, 1);

  // Fold surface variants that share a dedup key (graph + graphs), keeping the
  // most frequent surface form as the display term.
  const byKey = new Map<string, ExtractedTerm>();
  for (const [term, { count, ngram }] of counts) {
    const matchKey = canonicalize(term);
    const tf = count / denom;
    const ex = byKey.get(matchKey);
    if (!ex) {
      byKey.set(matchKey, { term, matchKey, count, ngram, tf });
      continue;
    }
    if (count > ex.count) ex.term = term;
    ex.count += count;
    ex.tf += tf;
    ex.ngram = Math.max(ex.ngram, ngram) as 1 | 2 | 3;
  }

  // Salience: frequency weighted by phrase length - multi-word concepts are
  // more meaningful for a second brain, so they sort ahead of bare words.
  return [...byKey.values()]
    .sort((a, b) => b.tf * b.ngram - a.tf * a.ngram)
    .slice(0, maxTerms);
}
