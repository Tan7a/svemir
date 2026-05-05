import { NextResponse, type NextRequest } from "next/server";
import { addItem } from "@/app/admin/actions";

export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function detectSourceType(url: string): string {
  if (url.includes("twitter.com") || url.includes("x.com")) return "x";
  if (url.includes("github.com")) return "github";
  if (url.includes("threads.net")) return "threads";
  if (url.includes("instagram.com")) return "instagram";
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (url.includes("dribbble.com")) return "dribbble";
  return "website";
}

function checkAuth(req: NextRequest): { ok: true } | { ok: false; res: NextResponse } {
  const expected = process.env.ARCHIVE_API_TOKEN;
  if (!expected) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "ARCHIVE_API_TOKEN is not set on the server" },
        { status: 500, headers: CORS_HEADERS }
      ),
    };
  }
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m || m[1] !== expected) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: CORS_HEADERS }
      ),
    };
  }
  return { ok: true };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const auth = checkAuth(req);
  if (!auth.ok) return auth.res;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const b = body as {
    url?: unknown;
    title?: unknown;
    description?: unknown;
    image_url?: unknown;
    source_name?: unknown;
    source_handle?: unknown;
    channelIds?: unknown;
    categories?: unknown;
    notes?: unknown;
    autoScrape?: unknown;
  };

  const url = typeof b.url === "string" ? b.url.trim() : "";
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json(
      { error: "Valid url required" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  let title = typeof b.title === "string" ? b.title.trim() : "";
  let description =
    typeof b.description === "string" ? b.description.trim() : "";
  let imageUrl =
    typeof b.image_url === "string" ? b.image_url.trim() : "";
  let sourceName =
    typeof b.source_name === "string" ? b.source_name.trim() : "";
  const sourceHandle =
    typeof b.source_handle === "string" ? b.source_handle.trim() : "";
  const channelIds = Array.isArray(b.channelIds)
    ? (b.channelIds.filter((x) => typeof x === "string") as string[])
    : [];
  const categories = Array.isArray(b.categories)
    ? (b.categories.filter((x) => typeof x === "string") as string[])
    : [];
  const notes = typeof b.notes === "string" ? b.notes : "";
  const autoScrape = b.autoScrape !== false;

  if (autoScrape && (!title || !imageUrl || !description)) {
    try {
      const ogs = (await import("open-graph-scraper")).default;
      const { result } = await ogs({ url, timeout: 6000 });
      if (!title && result.ogTitle) title = result.ogTitle;
      if (!description && result.ogDescription) {
        description = result.ogDescription;
      }
      if (!imageUrl) {
        const og = Array.isArray(result.ogImage)
          ? result.ogImage[0]?.url
          : (result.ogImage as { url?: string } | undefined)?.url;
        if (og && og.startsWith("https://")) imageUrl = og;
      }
      if (!sourceName && result.ogSiteName) sourceName = result.ogSiteName;
    } catch {
      // ignore — extension can pre-fill from tab.title before this
    }
  }

  if (!title) {
    return NextResponse.json(
      { error: "Could not determine a title for the URL. Pass `title`." },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const r = await addItem({
    url,
    title,
    description,
    image_url: imageUrl,
    source_name: sourceName,
    source_handle: sourceHandle,
    source_type: detectSourceType(url),
    categories,
    channelIds,
    notes,
  });

  if (!r.success) {
    return NextResponse.json(
      { error: r.error },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  return NextResponse.json(
    { id: r.itemId },
    { status: 201, headers: CORS_HEADERS }
  );
}
