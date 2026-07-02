import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a] p-8 text-neutral-300">
      <div className="max-w-lg text-center">
        <h1 className="text-2xl font-light text-neutral-100">Not found</h1>
        <p className="mt-3 text-sm text-neutral-400">
          That block doesn&apos;t exist or has been removed.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-xl border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-200 hover:text-neutral-100"
        >
          Back to svemir
        </Link>
      </div>
    </div>
  );
}
