import { notFound } from "next/navigation";
import TopBar from "@/components/TopBar";
import FacetDetail from "@/components/FacetDetail";
import { getFacetWithPapers } from "@/lib/queries";

export const revalidate = 60;

/**
 * Full-page facet view. Rendered on direct navigation / refresh. From within the
 * app, navigation to /facet/[slug] is intercepted by the @modal route and shown
 * as a side panel over the previous view (mirrors /block/[id]).
 */
export default async function FacetPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const facet = await getFacetWithPapers(slug);
  if (!facet) notFound();

  return (
    <>
      <TopBar />
      <main className="min-h-[calc(100vh-3rem)]">
        <FacetDetail facet={facet} />
      </main>
    </>
  );
}
