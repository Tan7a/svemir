import { NextRequest, NextResponse } from "next/server";
import { scrapeOpenGraph } from "@/lib/scrape";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { url } = (await req.json()) as { url?: string };
    if (!url) {
      return NextResponse.json({ error: "URL required" }, { status: 400 });
    }

    const meta = await scrapeOpenGraph(url);

    return NextResponse.json({
      title: meta.title ?? "",
      description: meta.description ?? "",
      image: meta.image ?? "",
      siteName: meta.siteName ?? "",
      sourceType: meta.sourceType,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
