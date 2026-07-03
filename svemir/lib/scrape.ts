import ogs from "open-graph-scraper";
import { detectSourceType } from "./bookmarks-parser";

export type ScrapedMetadata = {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  sourceType: string;
};

/**
 * Reject non-web schemes and obvious internal/private targets before fetching.
 * Defence-in-depth against SSRF: the scrape entry points are already behind
 * Basic Auth, but this keeps an authenticated mistake (or a future un-gated
 * caller) from reaching cloud metadata endpoints, localhost, or the LAN.
 */
function assertSafeUrl(raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) URLs can be scraped");
  }
  const host = u.hostname.toLowerCase();
  const isPrivate =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) || // link-local / cloud metadata (169.254.169.254)
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "[::1]" ||
    host.startsWith("[fc") || // unique-local IPv6 (fc00::/7)
    host.startsWith("[fd") ||
    host.startsWith("[fe80"); // link-local IPv6
  if (isPrivate) {
    throw new Error("Refusing to scrape a private or internal address");
  }
}

/**
 * Fetch OG metadata for a URL with a hard timeout. Single source of truth for
 * scraping across the admin form, "Scrape missing" bulk job, and the
 * bearer-token API. Caller is responsible for upstream error handling - this
 * helper throws on failure rather than returning an error shape, since the
 * three call sites all want different fallback behaviour.
 */
export async function scrapeOpenGraph(
  url: string,
  opts: { timeoutMs?: number } = {}
): Promise<ScrapedMetadata> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  assertSafeUrl(url);

  const { result } = (await Promise.race([
    ogs({ url, timeout: timeoutMs }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("scrape timeout")), timeoutMs)
    ),
  ])) as Awaited<ReturnType<typeof ogs>>;

  const ogImage = Array.isArray(result.ogImage)
    ? result.ogImage[0]?.url
    : (result.ogImage as { url?: string } | undefined)?.url;

  return {
    title: result.ogTitle,
    description: result.ogDescription,
    image: ogImage,
    siteName: result.ogSiteName,
    sourceType: detectSourceType(url),
  };
}
