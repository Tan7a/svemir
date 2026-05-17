import { NextRequest, NextResponse } from "next/server";
import { requireBearerToken } from "@/lib/auth";
import { addItem } from "@/app/admin/actions";
import { scrapeOpenGraph } from "@/lib/scrape";
import { detectSourceType } from "@/lib/bookmarks-parser";

export const runtime = "nodejs";

type Body = {
  source?: string;
  kind?: "link" | "image" | "text";
  title?: string;
  description?: string;
  image_url?: string;
  source_name?: string;
  source_handle?: string;
  source_type?: string;
  categories?: string[];
  channels?: string[];
};

function looksLikeUrl(s: string): boolean {
  try {
    const u = new URL(s.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireBearerToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const kind = body.kind ?? (body.source && looksLikeUrl(body.source) ? "link" : "link");
  const channels = (body.channels ?? []).filter(
    (c) => typeof c === "string" && c.trim()
  );
  const categories = (body.categories ?? []).filter(
    (c) => typeof c === "string" && c.trim()
  );

  let title = body.title?.trim() ?? "";
  let description = body.description?.trim() ?? "";
  let imageUrl = body.image_url?.trim() ?? "";
  let sourceName = body.source_name?.trim() ?? "";
  const sourceHandle = body.source_handle?.trim() ?? "";
  const url = body.source?.trim() ?? "";

  if (kind === "link") {
    if (!url || !looksLikeUrl(url)) {
      return NextResponse.json(
        { error: "Link blocks require a valid `source` URL." },
        { status: 400 }
      );
    }
    try {
      const meta = await scrapeOpenGraph(url);
      if (!title && meta.title) title = meta.title;
      if (!description && meta.description) description = meta.description;
      if (!imageUrl && meta.image) imageUrl = meta.image;
      if (!sourceName && meta.siteName) sourceName = meta.siteName;
    } catch {
      // Scrape failure is non-fatal — caller-provided fields still save.
    }
    if (!title) title = url;
  } else if (kind === "image") {
    if (!imageUrl) {
      return NextResponse.json(
        { error: "Image blocks require `image_url`." },
        { status: 400 }
      );
    }
    if (!title) {
      return NextResponse.json(
        { error: "Image blocks require `title`." },
        { status: 400 }
      );
    }
  } else if (kind === "text") {
    if (!description) {
      return NextResponse.json(
        { error: "Text blocks require `description`." },
        { status: 400 }
      );
    }
    if (!title) {
      return NextResponse.json(
        { error: "Text blocks require `title`." },
        { status: 400 }
      );
    }
  } else {
    return NextResponse.json(
      { error: `Unsupported kind: ${kind}` },
      { status: 400 }
    );
  }

  const result = await addItem({
    kind,
    url,
    title,
    description,
    image_url: imageUrl,
    source_name: sourceName,
    source_handle: sourceHandle,
    source_type:
      body.source_type?.trim() || (url ? detectSourceType(url) : "website"),
    categories,
    channelTitles: channels,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ id: result.id }, { status: 201 });
}
