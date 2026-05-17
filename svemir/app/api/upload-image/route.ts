import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 30;

const BUCKET = "screenshots";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

let bucketEnsured = false;

async function ensureBucket(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabaseAdmin) return { ok: false, error: "Admin client not configured" };
  if (bucketEnsured) return { ok: true };
  const { data: buckets, error: listErr } = await supabaseAdmin.storage.listBuckets();
  if (listErr) return { ok: false, error: listErr.message };
  if (!buckets?.some((b) => b.name === BUCKET)) {
    const { error: createErr } = await supabaseAdmin.storage.createBucket(
      BUCKET,
      {
        public: true,
        fileSizeLimit: MAX_BYTES,
        allowedMimeTypes: [...ALLOWED],
      }
    );
    if (createErr) return { ok: false, error: createErr.message };
  }
  bucketEnsured = true;
  return { ok: true };
}

export async function POST(req: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Server not configured (SUPABASE_SERVICE_ROLE_KEY missing)" },
      { status: 500 }
    );
  }

  const ensured = await ensureBucket();
  if (!ensured.ok) {
    return NextResponse.json({ error: ensured.error }, { status: 500 });
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` },
        { status: 400 }
      );
    }
    const type = file.type || "image/png";
    if (!ALLOWED.has(type)) {
      return NextResponse.json(
        { error: `Unsupported type: ${type}` },
        { status: 400 }
      );
    }

    const ext = type.split("/")[1] || "png";
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace(/Z$/, "");
    const random = Math.random().toString(36).slice(2, 8);
    const path = `${stamp}-${random}.${ext}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: type,
        upsert: false,
      });
    if (uploadErr) {
      return NextResponse.json(
        { error: `Upload failed: ${uploadErr.message}` },
        { status: 500 }
      );
    }

    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    return NextResponse.json({ url: pub.publicUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
