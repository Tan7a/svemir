import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isAuthed } from "@/lib/access-server";

export const runtime = "nodejs";

const BUCKET = "papers";

/**
 * Owner-only full text for a paper. THE copyright gate: the abstract + facets are
 * public (anon client, RLS select-using-true), but the full text lives in the
 * PRIVATE `papers` bucket and is only ever read here, behind isAuthed(). The
 * public gets 403 - the text never reaches a public payload.
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

/**
 * Owner-only save of the edited full text. Mirrors the GET gate (isAuthed). The
 * GET strips the YAML frontmatter for reading, so on write we re-attach the
 * original frontmatter block and replace only the body, then upsert back into
 * the private `papers` bucket at the same path.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Owner only." }, { status: 403 });
  }
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { text?: string } | null;
  const nextBody = (body?.text ?? "").trim();

  // Guardrail: a paper's full text is long, but not unbounded. Reject anything
  // implausibly large rather than writing it to storage.
  if (nextBody.length > 2_000_000) {
    return NextResponse.json({ error: "Full text is too large." }, { status: 413 });
  }

  const { data: item } = await supabaseAdmin
    .from("items")
    .select("kind, paper_full_text_path")
    .eq("id", id)
    .maybeSingle();

  if (!item || item.kind !== "paper" || !item.paper_full_text_path) {
    return NextResponse.json({ error: "No full text for this item." }, { status: 404 });
  }

  // Preserve the original frontmatter block (the GET strips it for reading).
  const { data: existing } = await supabaseAdmin.storage
    .from(BUCKET)
    .download(item.paper_full_text_path);
  const rawExisting = existing ? await existing.text() : "";
  const fm = rawExisting.match(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  const next = fm ? `${fm[0]}\n${nextBody}\n` : `${nextBody}\n`;

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(item.paper_full_text_path, new Blob([next], { type: "text/markdown" }), {
      upsert: true,
      contentType: "text/markdown",
    });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
