import { NextRequest, NextResponse } from "next/server";
import { requireBearerToken } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-server";
import { recentChannels } from "@/lib/channels";

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

  const data = await recentChannels(supabaseAdmin, 20);
  return NextResponse.json(data);
}
