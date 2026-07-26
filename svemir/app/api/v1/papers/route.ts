import { NextRequest, NextResponse } from "next/server";
import { requireBearerToken } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-server";
import { FACET_DIMENSION_BY_KEY } from "@/lib/constants";

export const runtime = "nodejs";
// Per-token and potentially carrying licensed text: never statically rendered
// or cached.
export const dynamic = "force-dynamic";

const BUCKET = "papers";
// Each full text is a separate download from the private bucket, so the
// full=1 page size is deliberately much smaller than the metadata one.
const MAX_LIMIT = 500;
const MAX_FULL_LIMIT = 25;

/**
 * GET /api/v1/papers - the research library as machine-readable JSON, for the
 * owner's own tooling.
 *
 * Behind the same api_tokens bearer gate as POST /api/v1/blocks: mint a token
 * in /admin/tokens and hand it to your own agent. It is NOT public, and it is
 * deliberately absent from robots/sitemap.
 *
 * This respects the copyright gate that app/api/papers/[id]/content already
 * establishes: a paper's abstract and facets are public, but its full text
 * lives in the private `papers` bucket and never reaches a public payload.
 * Note `items.body_text` is NOT the full text for papers - reading it here
 * would silently return the wrong thing.
 *
 * Query params:
 *   full=1        include full text from the private bucket (limit <= 25)
 *   limit/offset  page through the corpus (default 100)
 */

type FacetLink = {
  paper_facets: { dimension: string; value: string } | null;
};

type PaperRow = {
  id: string;
  url: string | null;
  title: string;
  description: string | null;
  source_name: string | null;
  paper_authors: string[] | null;
  paper_year: number | null;
  paper_full_text_path: string | null;
  created_at: string;
  paper_facet_links: FacetLink[] | null;
};

/** Read one paper's full text out of the private bucket, frontmatter stripped. */
async function readFullText(path: string): Promise<string | null> {
  if (!supabaseAdmin) return null;
  const { data: blob, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .download(path);
  if (error || !blob) return null;
  const raw = await blob.text();
  return raw.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

export async function GET(req: NextRequest) {
  const auth = await requireBearerToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Supabase admin is not configured on the server." },
      { status: 500 }
    );
  }

  const sp = req.nextUrl.searchParams;
  const includeFull = sp.get("full") === "1";
  const cap = includeFull ? MAX_FULL_LIMIT : MAX_LIMIT;
  const limit = Math.min(
    Math.max(Number(sp.get("limit")) || (includeFull ? 10 : 100), 1),
    cap
  );
  const offset = Math.max(Number(sp.get("offset")) || 0, 0);

  const { data, error, count } = await supabaseAdmin
    .from("items")
    .select(
      `id, url, title, description, source_name, paper_authors, paper_year,
       paper_full_text_path, created_at,
       paper_facet_links(paper_facets(dimension, value))`,
      { count: "exact" }
    )
    .eq("kind", "paper")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as PaperRow[];

  // Full texts in parallel: one bucket download each, so serial would crawl.
  const fullTexts = includeFull
    ? await Promise.all(
        rows.map((r) =>
          r.paper_full_text_path ? readFullText(r.paper_full_text_path) : null
        )
      )
    : [];

  const papers = rows.map((r, i) => {
    // Group facets by dimension under the human label the site uses, rather
    // than leaking raw dimension keys.
    const themes: Record<string, string[]> = {};
    for (const link of r.paper_facet_links ?? []) {
      const f = link.paper_facets;
      if (!f) continue;
      const label = FACET_DIMENSION_BY_KEY[f.dimension]?.label ?? f.dimension;
      (themes[label] ??= []).push(f.value);
    }
    return {
      id: r.id,
      title: r.title,
      authors: r.paper_authors ?? [],
      year: r.paper_year,
      abstract: r.description,
      source: r.source_name,
      url: r.url,
      permalink: `/block/${r.id}`,
      themes,
      addedAt: r.created_at,
      hasFullText: !!r.paper_full_text_path,
      ...(includeFull ? { fullText: fullTexts[i] } : {}),
    };
  });

  const total = count ?? papers.length;
  return NextResponse.json(
    {
      total,
      offset,
      limit,
      returned: papers.length,
      hasMore: offset + papers.length < total,
      fullTextIncluded: includeFull,
      papers,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
