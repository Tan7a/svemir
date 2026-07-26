"use client";

import { useAuthed } from "@/lib/use-authed";
import { IconDownload } from "@/components/ui/icons";

type Props = {
  /** Theme slug to scope the export to. Omit for every paper. */
  facet?: string;
  /** Concept slug to scope the export to. Omit for every paper. */
  concept?: string;
  /** Shown next to the icon; defaults to the unscoped wording. */
  label?: string;
};

/**
 * Owner-only "download the papers as CSV" control.
 *
 * A plain link, not a fetch: letting the browser follow it means the
 * Content-Disposition header does the saving, so there is no blob juggling and
 * the file lands with the server's filename. Hidden for signed-out visitors via
 * the hint cookie; the real gate is isAuthed() inside the route, which returns
 * 403 regardless of what the client renders.
 */
export default function ExportPapersButton({ facet, concept, label }: Props) {
  const authed = useAuthed();
  if (!authed) return null;

  const params = new URLSearchParams();
  if (facet) params.set("facet", facet);
  else if (concept) params.set("concept", concept);
  const qs = params.toString();

  return (
    <a
      href={`/api/papers/export${qs ? `?${qs}` : ""}`}
      className="inline-flex items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-900/70 px-3 py-1 text-xs text-neutral-400 transition-colors hover:text-neutral-100"
      title="Download these papers as a CSV table"
    >
      <IconDownload size={13} />
      {label ?? "Export CSV"}
    </a>
  );
}
