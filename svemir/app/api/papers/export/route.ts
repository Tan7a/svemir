import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isAuthed } from "@/lib/access-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/papers/export - owner-only CSV of the research library.
 *
 * Abstracts only, never the full text: that stays in the private `papers`
 * bucket behind app/api/papers/[id]/content. Same isAuthed() gate as the rest
 * of /api/papers, so a signed-out visitor gets 403.
 *
 * Scope (all optional, mutually exclusive):
 *   ?facet=<slug>    only papers tagged with that theme
 *   ?concept=<slug>  only papers mentioning that concept
 *   (neither)        every paper
 *
 * Column mapping follows migration 0007, which reuses existing item columns:
 * description = abstract, source_name = venue/journal, url = DOI/link. There is
 * no separate DOI column, so "publisher" and "DOI / link" come from those two.
 */

// PostgREST caps a single response at 1000 rows. Everything here pages.
const PAGE = 1000;
const MAX_PAGES = 50;

type PaperRow = {
  title: string | null;
  paper_authors: string[] | null;
  paper_year: number | null;
  source_name: string | null;
  url: string | null;
  description: string | null;
};

/** RFC 4180: wrap in quotes, double any embedded quote. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  // Abstracts routinely contain commas, quotes and newlines, so every cell is
  // quoted rather than only the ones that look risky.
  const s = String(value).replace(/\r\n|\r|\n/g, " ").trim();
  return `"${s.replace(/"/g, '""')}"`;
}

/** Page through a filtered id list (facet or concept membership). */
async function collectIds(
  table: "paper_facet_links" | "block_concepts",
  idColumn: "paper_id" | "block_id",
  filterColumn: "facet_id" | "concept_id",
  filterValue: string
): Promise<string[]> {
  if (!supabaseAdmin) return [];
  const ids: string[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE;
    const { data } = await supabaseAdmin
      .from(table)
      .select(idColumn)
      .eq(filterColumn, filterValue)
      .range(from, from + PAGE - 1);
    if (!data?.length) break;
    ids.push(...data.map((r) => (r as Record<string, string>)[idColumn]));
    if (data.length < PAGE) break;
  }
  return ids;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Owner only." }, { status: 403 });
  }
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  }

  const sp = req.nextUrl.searchParams;
  const facetSlug = sp.get("facet");
  const conceptSlug = sp.get("concept");

  // Resolve an optional scope to the set of paper ids it covers.
  let onlyIds: string[] | null = null;
  let scopeLabel = "all";

  if (facetSlug) {
    const { data: facet } = await supabaseAdmin
      .from("paper_facets")
      .select("id, value")
      .eq("slug", facetSlug)
      .maybeSingle();
    if (!facet) {
      return NextResponse.json({ error: "Unknown theme." }, { status: 404 });
    }
    onlyIds = await collectIds(
      "paper_facet_links",
      "paper_id",
      "facet_id",
      facet.id as string
    );
    scopeLabel = String(facet.value ?? facetSlug);
  } else if (conceptSlug) {
    const { data: concept } = await supabaseAdmin
      .from("concepts")
      .select("id, term")
      .eq("slug", conceptSlug)
      .maybeSingle();
    if (!concept) {
      return NextResponse.json({ error: "Unknown concept." }, { status: 404 });
    }
    onlyIds = await collectIds(
      "block_concepts",
      "block_id",
      "concept_id",
      concept.id as string
    );
    scopeLabel = String(concept.term ?? conceptSlug);
  }

  // An empty scope means "no papers", not "no filter" - guard before querying.
  const rows: PaperRow[] = [];
  if (!onlyIds || onlyIds.length > 0) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE;
      let q = supabaseAdmin
        .from("items")
        .select(
          "title, paper_authors, paper_year, source_name, url, description"
        )
        .eq("kind", "paper")
        .order("paper_year", { ascending: false, nullsFirst: false })
        .order("title", { ascending: true })
        .range(from, from + PAGE - 1);
      if (onlyIds) q = q.in("id", onlyIds);

      const { data, error } = await q;
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (!data?.length) break;
      rows.push(...(data as PaperRow[]));
      if (data.length < PAGE) break;
    }
  }

  const header = [
    "Paper",
    "Authors",
    "Year",
    "Publisher",
    "DOI / link",
    "Abstract",
  ];
  const lines = [
    header.map(csvCell).join(","),
    ...rows.map((r) =>
      [
        csvCell(r.title),
        csvCell((r.paper_authors ?? []).join("; ")),
        csvCell(r.paper_year),
        csvCell(r.source_name),
        csvCell(r.url),
        csvCell(r.description),
      ].join(",")
    ),
  ];

  // Leading BOM so Excel opens UTF-8 author names correctly instead of mojibake.
  const csv = "﻿" + lines.join("\r\n") + "\r\n";

  const stamp = new Date().toISOString().slice(0, 10);
  const safeScope = scopeLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const filename = `svemir-papers-${safeScope || "all"}-${stamp}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
