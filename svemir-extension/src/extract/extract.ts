// Runs in the page's MAIN world via chrome.scripting.executeScript.
// Must be self-contained — no imports, no closures from the extension
// bundle reach this code at runtime.

export type ExtractedAsset = {
  url: string;
  title: string;
  description: string;
  image_url: string;
  source_name: string;
  kind: "link" | "image" | "text";
  body_text: string;
};

export function extractAsset(): ExtractedAsset {
  const host = location.hostname.replace(/^www\./, "");

  const hostSelectors: Record<string, string> = {
    "pinterest.com": '[data-test-id="pin-closeup-image"] img',
    "instagram.com": "article img[srcset]",
    "x.com": 'div[data-testid="tweetPhoto"] img',
    "twitter.com": 'div[data-testid="tweetPhoto"] img',
  };

  function metaContent(name: string): string {
    const sel = `meta[property="${name}"], meta[name="${name}"]`;
    const el = document.querySelector(sel) as HTMLMetaElement | null;
    return el?.content?.trim() ?? "";
  }

  function pickFromSrcset(img: HTMLImageElement): string {
    const set = img.srcset;
    if (!set) return img.src;
    // pick the largest width descriptor
    let best = { url: img.src, w: 0 };
    for (const part of set.split(",")) {
      const [url, descriptor] = part.trim().split(/\s+/);
      const m = descriptor?.match(/^(\d+)w$/);
      const w = m ? parseInt(m[1], 10) : 0;
      if (w > best.w) best = { url, w };
    }
    return best.url;
  }

  function hostImage(): string {
    const sel = hostSelectors[host];
    if (!sel) return "";
    const el = document.querySelector(sel) as HTMLImageElement | null;
    if (!el) return "";
    return pickFromSrcset(el);
  }

  const title =
    metaContent("og:title") ||
    metaContent("twitter:title") ||
    document.title;

  const description =
    metaContent("og:description") ||
    metaContent("twitter:description") ||
    metaContent("description");

  let image_url =
    hostImage() ||
    metaContent("og:image") ||
    metaContent("twitter:image");

  if (!image_url) {
    const linkRel = document.querySelector(
      'link[rel="image_src"]'
    ) as HTMLLinkElement | null;
    if (linkRel?.href) image_url = linkRel.href;
  }

  const source_name = metaContent("og:site_name") || host;

  // Extract readable body text: prefer <article> > <main> > body, then
  // collapse whitespace and cap at 50KB. Strips nav/scripts/styles via
  // document.body.innerText (the browser already filters those).
  function readBodyText(): string {
    const candidates: HTMLElement[] = [];
    document.querySelectorAll("article").forEach((el) => {
      candidates.push(el as HTMLElement);
    });
    if (candidates.length === 0) {
      document.querySelectorAll("main").forEach((el) => {
        candidates.push(el as HTMLElement);
      });
    }
    let raw = "";
    if (candidates.length > 0) {
      // Pick the longest matching region; SPAs often have multiple <article>.
      let best = candidates[0];
      for (const c of candidates) {
        if ((c.innerText?.length ?? 0) > (best.innerText?.length ?? 0)) {
          best = c;
        }
      }
      raw = best.innerText ?? "";
    } else {
      raw = document.body?.innerText ?? "";
    }
    const cleaned = raw.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    const MAX = 50_000;
    return cleaned.length > MAX ? cleaned.slice(0, MAX) + "\n…(truncated)" : cleaned;
  }

  return {
    url: location.href,
    title: title.trim(),
    description: description.trim(),
    image_url,
    source_name,
    kind: "link",
    body_text: readBodyText(),
  };
}
