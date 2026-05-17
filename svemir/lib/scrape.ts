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
 * Fetch OG metadata for a URL with a hard timeout. Single source of truth for
 * scraping across the admin form, "Scrape missing" bulk job, and the
 * bearer-token API. Caller is responsible for upstream error handling — this
 * helper throws on failure rather than returning an error shape, since the
 * three call sites all want different fallback behaviour.
 */
export async function scrapeOpenGraph(
  url: string,
  opts: { timeoutMs?: number } = {}
): Promise<ScrapedMetadata> {
  const timeoutMs = opts.timeoutMs ?? 5000;

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
