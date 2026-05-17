import { permanentRedirect } from "next/navigation";

/**
 * Legacy URL — the unified home now lives at `/`. Preserve old links by
 * permanently redirecting.
 */
export default function ArchiveRedirect() {
  permanentRedirect("/");
}
