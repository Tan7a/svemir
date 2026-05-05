import { Suspense } from "react";
import AdminForm from "@/components/AdminForm";
import AdminNav from "@/components/AdminNav";

export default function AdminPage() {
  return (
    <div className="min-h-screen bg-[#FBF8F4]">
      <AdminNav active="add" />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-bold mb-6">Add to archive</h1>
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <AdminForm />
        </Suspense>
      </main>
    </div>
  );
}
