import AdminNav from "@/components/AdminNav";
import ImportForm from "@/components/ImportForm";

export default function ImportPage() {
  return (
    <div className="min-h-screen bg-[#FBF8F4]">
      <AdminNav active="import" />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-bold mb-2">Bulk import bookmarks</h1>
        <p className="mb-6 text-sm text-zinc-600">
          Export bookmarks from Chrome (Bookmark manager → Export bookmarks →
          .html), drop the file here, then pick which folders to import.
        </p>
        <ImportForm />
      </main>
    </div>
  );
}
