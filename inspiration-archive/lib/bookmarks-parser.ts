import { CATEGORIES } from "./constants";

export type ParsedBookmark = {
  url: string;
  title: string;
  folderPath: string[];
};

export type ParsedFolder = {
  path: string[];
  count: number;
};

const SKIP_FOLDERS = new Set([
  "bookmarks bar",
  "bookmarks menu",
  "other bookmarks",
  "mobile bookmarks",
  "favorites",
  "favorites bar",
]);

const CATEGORY_LOOKUP = new Map<string, string>(
  CATEGORIES.map((c) => [c.toLowerCase(), c])
);

export function parseBookmarksHtml(html: string): {
  bookmarks: ParsedBookmark[];
  folders: ParsedFolder[];
} {
  const bookmarks: ParsedBookmark[] = [];
  const folderCounts = new Map<string, { path: string[]; count: number }>();

  const stack: string[] = [];
  let pos = 0;
  const len = html.length;

  while (pos < len) {
    const dlOpen = html.indexOf("<DL", pos);
    const dlClose = html.indexOf("</DL", pos);
    const h3Open = html.indexOf("<H3", pos);
    const aOpen = html.indexOf("<A ", pos);

    const candidates = [
      { kind: "dlOpen", at: dlOpen },
      { kind: "dlClose", at: dlClose },
      { kind: "h3Open", at: h3Open },
      { kind: "aOpen", at: aOpen },
    ].filter((c) => c.at !== -1);
    if (candidates.length === 0) break;
    candidates.sort((a, b) => a.at - b.at);
    const next = candidates[0];

    if (next.kind === "dlOpen") {
      pos = next.at + 3;
    } else if (next.kind === "dlClose") {
      if (stack.length > 0) stack.pop();
      pos = next.at + 4;
    } else if (next.kind === "h3Open") {
      const close = html.indexOf("</H3>", next.at);
      if (close === -1) break;
      const tagStart = html.indexOf(">", next.at);
      const name = decodeEntities(
        html.substring(tagStart + 1, close).trim()
      );
      stack.push(name);
      const key = stack.join("/");
      if (!folderCounts.has(key)) {
        folderCounts.set(key, { path: [...stack], count: 0 });
      }
      pos = close + 5;
    } else if (next.kind === "aOpen") {
      const tagEnd = html.indexOf(">", next.at);
      if (tagEnd === -1) break;
      const close = html.indexOf("</A>", tagEnd);
      if (close === -1) break;
      const attrs = html.substring(next.at + 3, tagEnd);
      const title = decodeEntities(
        html.substring(tagEnd + 1, close).trim()
      );
      const hrefMatch = attrs.match(/HREF="([^"]+)"/i);
      if (hrefMatch && title) {
        const url = decodeEntities(hrefMatch[1]);
        const folderPath = [...stack];
        bookmarks.push({ url, title, folderPath });
        const key = folderPath.join("/");
        const existing = folderCounts.get(key);
        if (existing) existing.count += 1;
        else if (folderPath.length > 0) {
          folderCounts.set(key, { path: folderPath, count: 1 });
        }
      }
      pos = close + 4;
    }
  }

  const folders = [...folderCounts.values()]
    .filter((f) => f.path.length > 0 && f.count > 0)
    .sort((a, b) => a.path.join("/").localeCompare(b.path.join("/")));

  return { bookmarks, folders };
}

export function deriveTagsAndCategories(
  folderPath: string[]
): { tags: string[]; categories: string[] } {
  const tags = new Set<string>();
  const categories = new Set<string>();

  for (const raw of folderPath) {
    const lc = raw.toLowerCase().trim();
    if (!lc || SKIP_FOLDERS.has(lc)) continue;

    const matched = CATEGORY_LOOKUP.get(lc);
    if (matched) categories.add(matched);

    const slug = lc
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (slug && slug.length <= 40) tags.add(slug);
  }

  return { tags: [...tags], categories: [...categories] };
}

export function detectSourceType(url: string): string {
  if (url.includes("twitter.com") || url.includes("x.com")) return "x";
  if (url.includes("github.com")) return "github";
  if (url.includes("threads.net")) return "threads";
  if (url.includes("instagram.com")) return "instagram";
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (url.includes("dribbble.com")) return "dribbble";
  return "website";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'");
}
