import TopBar from "@/components/TopBar";

/**
 * Skeleton shown while a channel page hydrates. Mirrors the real
 * layout (title bar + dense block grid) so the LCP shift on resolve
 * is minimal.
 */
export default function Loading() {
  return (
    <>
      <TopBar />
      <div className="border-b border-neutral-900">
        <div className="px-5 pt-8 pb-6">
          <div className="h-9 w-96 animate-pulse rounded bg-neutral-900" />
          <div className="mt-3 h-3 w-48 animate-pulse rounded bg-neutral-900" />
        </div>
      </div>
      <main className="px-3 pt-8">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square w-full animate-pulse border border-neutral-800 bg-neutral-900"
            />
          ))}
        </div>
      </main>
    </>
  );
}
