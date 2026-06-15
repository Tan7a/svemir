import { Suspense } from "react";
import { notFound } from "next/navigation";
import BlockDetail from "@/components/BlockDetail";
import Modal from "@/components/Modal";
import { getBlockWithChannels } from "@/lib/queries";

/**
 * Intercepted route. When the user navigates to /block/[id] from within the
 * app (e.g. clicking a BlockCard), this renders as a right-side panel layered
 * over whichever view they were on.
 *
 * On hard navigation (refresh, direct URL, share link), `(.)block` is NOT
 * matched and the full-page route renders instead.
 *
 * The panel is mounted ONCE here, synchronously, so it slides in a single time.
 * The data fetch happens inside a Suspense boundary, so only the inner content
 * swaps from skeleton → loaded — no second panel, no replayed animation. (Using
 * a segment-level loading.tsx would instead mount its own <Modal>, causing the
 * "double open" glitch.)
 */
export default function InterceptedBlockPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Modal>
      <Suspense fallback={<BlockDetailSkeleton />}>
        <BlockDetailContent params={params} />
      </Suspense>
    </Modal>
  );
}

async function BlockDetailContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const block = await getBlockWithChannels(id);
  if (!block) notFound();
  return <BlockDetail block={block} inModal />;
}

/** Stacked skeleton matching the panel's image-on-top layout. */
function BlockDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <div className="h-[40vh] w-full animate-pulse rounded-sm bg-neutral-900" />
      <div className="h-7 w-3/4 animate-pulse rounded-md bg-neutral-900" />
      <div className="h-4 w-1/2 animate-pulse rounded bg-neutral-900" />
      <div className="mt-2 h-3 w-full animate-pulse rounded bg-neutral-900" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-neutral-900" />
    </div>
  );
}
