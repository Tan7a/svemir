import { NextResponse, type NextRequest } from "next/server";
import { supabase } from "@/lib/supabase-client";
import { createChannel } from "@/app/admin/actions";

export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function checkAuth(req: NextRequest): { ok: true } | { ok: false; res: NextResponse } {
  const expected = process.env.ARCHIVE_API_TOKEN;
  if (!expected) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "ARCHIVE_API_TOKEN is not set on the server" },
        { status: 500, headers: CORS_HEADERS }
      ),
    };
  }
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m || m[1] !== expected) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: CORS_HEADERS }
      ),
    };
  }
  return { ok: true };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  const auth = checkAuth(req);
  if (!auth.ok) return auth.res;

  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  const { data, error } = await supabase
    .from("channels")
    .select("id, name, slug, item_channels(count)")
    .order("name");

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  const channels = (data ?? []).map((row) => {
    const counts = row.item_channels as { count: number }[] | null;
    return {
      id: row.id as string,
      name: row.name as string,
      slug: row.slug as string,
      itemCount: counts?.[0]?.count ?? 0,
    };
  });

  return NextResponse.json(
    { channels },
    { status: 200, headers: CORS_HEADERS }
  );
}

export async function POST(req: NextRequest) {
  const auth = checkAuth(req);
  if (!auth.ok) return auth.res;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  const b = body as { name?: unknown; description?: unknown };
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) {
    return NextResponse.json(
      { error: "Channel name required" },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  const description =
    typeof b.description === "string" ? b.description : undefined;

  const r = await createChannel(name, description);
  if (!r.success) {
    return NextResponse.json(
      { error: r.error },
      { status: 500, headers: CORS_HEADERS }
    );
  }
  return NextResponse.json(
    { channel: r.channel },
    { status: 201, headers: CORS_HEADERS }
  );
}
