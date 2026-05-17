import { NextRequest, NextResponse } from "next/server";
import { requireBearerToken } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-server";
import { channelStats } from "@/lib/channels";
import { suggestChannels, type SuggestionInput } from "@/lib/suggest";

export const runtime = "nodejs";

type Body = Partial<SuggestionInput>;

export async function POST(req: NextRequest) {
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

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const input: SuggestionInput = {
    title: body.title?.trim() ?? "",
    description: body.description?.trim() ?? "",
    source_name: body.source_name?.trim() ?? "",
  };

  if (!input.title && !input.description && !input.source_name) {
    return NextResponse.json([]);
  }

  const stats = await channelStats(supabaseAdmin);
  return NextResponse.json(suggestChannels(input, stats));
}
