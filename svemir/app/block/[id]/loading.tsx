import TopBar from "@/components/TopBar";

/**
 * Skeleton shown while /block/[id] fetches its data. With Next.js
 * Suspense + Link prefetching, this paints instantly on click so the
 * full-page block detail feels snappy even on a cold cache.
 */
export default function Loading() {
  return (
    <>
      <TopBar />
      <main className="min-h-[calc(100vh-3rem)]">
        <div className="grid grid-cols-1 gap-8 px-8 py-8 md:grid-cols-[1fr_22rem]">
          <div className="flex flex-col gap-4">
            <div className="h-7 w-72 animate-pulse rounded-xl bg-neutral-900" />
            <div className="h-[60vh] w-full animate-pulse rounded-xl bg-neutral-900" />
          </div>
          <aside className="flex flex-col gap-4">
            <div className="h-8 w-2/3 animate-pulse rounded bg-neutral-900" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-neutral-900" />
            <div className="mt-4 h-3 w-full animate-pulse rounded bg-neutral-900" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-900" />
          </aside>
        </div>
      </main>
    </>
  );
}
