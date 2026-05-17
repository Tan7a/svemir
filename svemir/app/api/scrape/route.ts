import { NextRequest, NextResponse } from "next/server";
import ogs from "open-graph-scraper";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { url } = (await req.json()) as { url?: string };
    if (!url) {
      return NextResponse.json({ error: "URL required" }, { status: 400 });
    }

    const { result } = await ogs({ url });

    let sourceType = "website";
    if (url.includes("twitter.com") || url.includes("x.com")) sourceType = "x";
    else if (url.includes("github.com")) sourceType = "github";
    else if (url.includes("threads.net")) sourceType = "threads";
    else if (url.includes("instagram.com")) sourceType = "instagram";
    else if (url.includes("youtube.com") || url.includes("youtu.be"))
      sourceType = "youtube";
    else if (url.includes("dribbble.com")) sourceType = "dribbble";

    const ogImage = Array.isArray(result.ogImage)
      ? result.ogImage[0]?.url
      : (result.ogImage as { url?: string } | undefined)?.url;

    return NextResponse.json({
      title: result.ogTitle ?? "",
      description: result.ogDescription ?? "",
      image: ogImage ?? "",
      siteName: result.ogSiteName ?? "",
      sourceType,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
