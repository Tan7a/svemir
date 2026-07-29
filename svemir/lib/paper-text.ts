/**
 * Cleaning for paper markdown pulled from the private `papers` bucket.
 *
 * Copyright gate: a paper's full text must never be persisted to `items` or
 * reach a public payload (see app/api/papers/[id]/content). This helper exists
 * so concept extraction can read the text transiently, in memory, and throw it
 * away: strip the noise that would pollute term extraction, cap the size, and
 * hand the digest to `reconcileBlockConcepts` as an ephemeral `body_text`.
 */

export const PAPERS_BUCKET = "papers";

/** Matches the extractor's own body cap (lib/extract-terms.ts). */
const MAX_CHARS = 20000;

export function cleanPaperMarkdown(raw: string): string {
  // YAML frontmatter (same shape app/api/v1/papers strips).
  let text = raw.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");

  // The "## Metadata" block of **Label:** lines injects author/journal noise.
  text = text.replace(/(^|\n)#{1,6}\s+Metadata\b[\s\S]*?(?=\n#{1,6}\s|$)/i, "\n");

  // Citation strings are the worst extraction pollution: cut everything from a
  // trailing References heading onward.
  const refs = text.search(/\n(#{1,6}\s+References\b|\*\*References\*\*)/i);
  if (refs !== -1) text = text.slice(0, refs);

  return text.trim().slice(0, MAX_CHARS);
}
