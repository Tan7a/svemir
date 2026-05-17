import { NextRequest, NextResponse } from "next/server";
import { parseBookmarksHtml } from "@/lib/bookmarks-parser";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    const html = await file.text();
    const { bookmarks, folders } = parseBookmarksHtml(html);
    return NextResponse.json({
      totalBookmarks: bookmarks.length,
      folders: folders.map((f) => ({
        path: f.path,
        key: f.path.join("/"),
        count: f.count,
      })),
      bookmarks,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to parse";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
