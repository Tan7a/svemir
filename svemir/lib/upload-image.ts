import sharp from "sharp";
import { supabaseAdmin } from "@/lib/supabase-server";

// Shared by /api/upload-image (admin UI) and /api/v1/upload-image (extension).
// Both take an uploaded screenshot, optimize it once, and store it in Supabase.
export const BUCKET = "screenshots";
export const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

// Cap on the longest edge. 1600px keeps detail-view images crisp while cutting
// retina screenshots (often 2500px+) down dramatically.
const MAX_EDGE = 1600;

type UploadResult = { ok: true; url: string } | { ok: false; error: string };

let bucketEnsured = false;

async function ensureBucket(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  if (!supabaseAdmin) return { ok: false, error: "Admin client not configured" };
  if (bucketEnsured) return { ok: true };
  const { data: buckets, error: listErr } =
    await supabaseAdmin.storage.listBuckets();
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

// Optimize once, here at upload time, instead of relying on Vercel's metered
// per-view Image Optimization. Animated GIFs pass through untouched so their
// animation survives; any sharp failure falls back to the original bytes so an
// upload never fails just because optimization did.
async function optimize(
  buffer: Buffer,
  mimeType: string
): Promise<{ data: Buffer; contentType: string; ext: string }> {
  if (mimeType === "image/gif") {
    return { data: buffer, contentType: "image/gif", ext: "gif" };
  }
  try {
    const webp = await sharp(buffer)
      .rotate() // honour EXIF orientation before metadata is dropped
      .resize({
        width: MAX_EDGE,
        height: MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer();
    return { data: webp, contentType: "image/webp", ext: "webp" };
  } catch {
    const ext = mimeType.split("/")[1] || "png";
    return { data: buffer, contentType: mimeType, ext };
  }
}

export async function uploadScreenshot(
  buffer: Buffer,
  mimeType: string
): Promise<UploadResult> {
  if (!supabaseAdmin) return { ok: false, error: "Admin client not configured" };

  const ensured = await ensureBucket();
  if (!ensured.ok) return { ok: false, error: ensured.error };

  const { data, contentType, ext } = await optimize(buffer, mimeType);

  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/Z$/, "");
  const random = Math.random().toString(36).slice(2, 8);
  const path = `${stamp}-${random}.${ext}`;

  // Upload as a Blob, NOT a raw Buffer. supabase-js sends a Buffer/Uint8Array
  // as a plain fetch body, which Vercel's runtime UTF-8-decodes and corrupts
  // (binary bytes turn into replacement chars, producing undecodable files).
  // A Blob forces the multipart/form-data path, where the bytes travel as a
  // binary file part and stay intact.
  const body = new Blob([new Uint8Array(data)], { type: contentType });
  const { error: uploadErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, body, { contentType, upsert: false });
  if (uploadErr) {
    return { ok: false, error: `Upload failed: ${uploadErr.message}` };
  }

  const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  return { ok: true, url: pub.publicUrl };
}
