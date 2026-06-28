import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isAuthed } from "@/lib/access-server";

export const runtime = "nodejs";

const BUCKET = "papers";

/**
 * Owner-only full text for a paper. THE copyright gate: the abstract + facets are
 * public (anon client, RLS select-using-true), but the full text lives in the
 * PRIVATE `papers` bucket and is only ever read here, behind isAuthed(). The
 * public gets 403 — the text never reaches a public payload.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Owner only." }, { status: 403 });
  }
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  }

  const { id } = await params;
  const { data: item } = await supabaseAdmin
    .from("items")
    .select("kind, paper_full_text_path")
    .eq("id", id)
    .maybeSingle();

  if (!item || item.kind !== "paper" || !item.paper_full_text_path) {
    return NextResponse.json({ error: "No full text for this item." }, { status: 404 });
  }

  const { data: blob, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .download(item.paper_full_text_path);
  if (error || !blob) {
    return NextResponse.json(
      { error: error?.message ?? "Could not read full text." },
      { status: 500 }
    );
  }

  // Strip the YAML frontmatter block for cleaner reading; the body keeps its
  // headings and the original document text.
  const raw = await blob.text();
  const text = raw.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();

  return NextResponse.json({ text });
}
