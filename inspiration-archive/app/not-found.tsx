import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FBF8F4] p-8">
      <div className="max-w-lg text-center">
        <h1 className="text-2xl font-semibold text-zinc-900">Not found</h1>
        <p className="mt-3 text-sm text-zinc-700">
          That item doesn&apos;t exist or has been removed.
        </p>
        <Link
          href="/archive"
          className="mt-6 inline-block rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Back to archive
        </Link>
      </div>
    </div>
  );
}
