import type { ChannelStat } from "./channels";
import { STOPWORDS } from "./stopwords";

export type SuggestionInput = {
  title: string;
  description: string;
  source_name: string;
};

export type Suggestion = {
  title: string;
  score: number;
  autoSelect: boolean;
};

function tokenize(s: string): Set<string> {
  const tokens = s
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return new Set(tokens);
}

/**
 * Score existing channels by relevance to the block being added.
 *
 * +2 per overlapping token between (title + description) and channel title.
 * +1 per matching source_name (channel already collects from this host).
 *
 * Top 5 by score (score > 0). Up to 2 entries with score >= 3 are flagged
 * autoSelect so the UI can pre-tick them - feels helpful without being
 * presumptuous when nothing strongly matches.
 *
 * Pure function. No I/O. No external calls.
 */
export function suggestChannels(
  input: SuggestionInput,
  channels: ChannelStat[]
): Suggestion[] {
  const contentTokens = tokenize(`${input.title} ${input.description}`);
  if (contentTokens.size === 0 && !input.source_name) return [];

  const sourceName = input.source_name.trim();

  type Scored = { title: string; score: number };
  const scored: Scored[] = [];

  for (const ch of channels) {
    const titleTokens = tokenize(ch.title);
    let overlap = 0;
    for (const t of contentTokens) {
      if (titleTokens.has(t)) overlap += 1;
    }
    let score = overlap * 2;
    if (sourceName && ch.source_names.some((s) => s === sourceName)) {
      score += 1;
    }
    if (score > 0) scored.push({ title: ch.title, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 5);

  let autoSelectsLeft = 2;
  return top.map((s) => {
    const autoSelect = s.score >= 3 && autoSelectsLeft > 0;
    if (autoSelect) autoSelectsLeft -= 1;
    return { ...s, autoSelect };
  });
}
