import { NextRequest, NextResponse } from "next/server";
import { requireBearerToken } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireBearerToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Supabase admin not configured." },
      { status: 500 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("channels")
    .select("id, slug, title")
    .order("title", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}
