import { notFound } from "next/navigation";
import BlockDetail from "@/components/BlockDetail";
import Modal from "@/components/Modal";
import { getBlockWithChannels } from "@/lib/queries";

/**
 * Intercepted route. When the user navigates to /block/[id] from within the
 * app (e.g. clicking a BlockCard from the Blocks view), this page renders
 * instead of `app/block/[id]/page.tsx`, layered as a modal over whichever
 * view they were on.
 *
 * On hard navigation (refresh, direct URL paste, share link), `(.)block` is
 * NOT matched and the full-page route renders instead.
 *
 * The `(.)` matcher is same-segment-level. Because `@modal` is a slot (not
 * a segment), `/block` is one segment level higher despite being two
 * file-system levels higher.
 */
export default async function InterceptedBlockPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const block = await getBlockWithChannels(id);
  if (!block) notFound();

  return (
    <Modal>
      <BlockDetail block={block} inModal />
    </Modal>
  );
}
