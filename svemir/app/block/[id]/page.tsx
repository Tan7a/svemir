import { notFound } from "next/navigation";
import TopBar from "@/components/TopBar";
import BlockDetail from "@/components/BlockDetail";
import { getBlockWithChannels } from "@/lib/queries";

export const revalidate = 60;

/**
 * Full-page block detail. Rendered on direct navigation / refresh.
 * From within the app, navigation to /block/[id] is intercepted by
 * `app/@modal/(.)block/[id]/page.tsx` which renders the same content as a
 * modal overlay over the previous view.
 */
export default async function BlockPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const block = await getBlockWithChannels(id);
  if (!block) notFound();

  return (
    <>
      <TopBar />
      <main className="min-h-[calc(100vh-3rem)]">
        <BlockDetail block={block} />
      </main>
    </>
  );
}
