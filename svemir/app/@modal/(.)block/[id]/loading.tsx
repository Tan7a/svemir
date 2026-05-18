import Modal from "@/components/Modal";

/**
 * Skeleton for the intercepted block-detail modal. Pops the dark overlay
 * + close affordances immediately on click; the body fills in once the
 * server fetch resolves. Important on a cold router cache — without
 * this the modal blocks on the network round-trip before painting.
 */
export default function Loading() {
  return (
    <Modal>
      <div className="grid grid-cols-1 gap-8 px-8 py-8 md:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-4">
          <div className="h-7 w-72 animate-pulse rounded-md bg-neutral-900" />
          <div className="h-[60vh] w-full animate-pulse rounded-sm bg-neutral-900" />
        </div>
        <aside className="flex flex-col gap-4">
          <div className="h-8 w-2/3 animate-pulse rounded bg-neutral-900" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-neutral-900" />
          <div className="mt-4 h-3 w-full animate-pulse rounded bg-neutral-900" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-900" />
        </aside>
      </div>
    </Modal>
  );
}
