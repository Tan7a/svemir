import { permanentRedirect } from "next/navigation";

/**
 * Legacy URL - items are now blocks. Preserve old links by permanently
 * redirecting `/item/[id]` → `/block/[id]`.
 */
export default async function ItemRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  permanentRedirect(`/block/${id}`);
}
