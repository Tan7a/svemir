import AdminTabs from "@/components/AdminTabs";
import TopBar from "@/components/TopBar";
import ImportForm from "@/components/ImportForm";

export default function ImportPage() {
  return (
    <>
      <TopBar />
      <AdminTabs active="import" />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="mb-2 text-2xl font-light text-neutral-100">
          Bulk import bookmarks
        </h1>
        <p className="mb-6 text-sm text-neutral-400">
          Export bookmarks from Chrome (Bookmark manager → Export bookmarks →
          .html), drop the file here, then pick which folders to import.
        </p>
        <ImportForm />
      </main>
    </>
  );
}
