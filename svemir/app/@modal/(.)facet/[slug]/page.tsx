import { Suspense } from "react";
import { notFound } from "next/navigation";
import FacetDetail from "@/components/FacetDetail";
import Modal from "@/components/Modal";
import { getFacetWithPapers } from "@/lib/queries";

/**
 * Intercepted facet route. Clicking a facet tag from within the app opens the
 * panel as a right-side overlay; a hard navigation / refresh falls through to
 * the full page. Mirrors @modal/(.)block/[id].
 */
export default function InterceptedFacetPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return (
    <Modal>
      <Suspense fallback={<FacetDetailSkeleton />}>
        <FacetDetailContent params={params} />
      </Suspense>
    </Modal>
  );
}

async function FacetDetailContent({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const facet = await getFacetWithPapers(slug);
  if (!facet) notFound();
  return <FacetDetail facet={facet} inModal />;
}

function FacetDetailSkeleton() {
  return (
    <div className="flex flex-col gap-5 px-6 py-6">
      <div className="h-4 w-24 animate-pulse rounded bg-neutral-900" />
      <div className="h-8 w-2/3 animate-pulse rounded-md bg-neutral-900" />
      <div className="h-3 w-full animate-pulse rounded bg-neutral-900" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-neutral-900" />
      <div className="mt-4 h-16 w-full animate-pulse rounded bg-neutral-900" />
      <div className="h-16 w-full animate-pulse rounded bg-neutral-900" />
    </div>
  );
}
