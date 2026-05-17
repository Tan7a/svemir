import AdminForm from "@/components/AdminForm";
import AdminTabs from "@/components/AdminTabs";
import TopBar from "@/components/TopBar";

export default function AdminPage() {
  return (
    <>
      <TopBar />
      <AdminTabs active="add" />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="mb-6 text-2xl font-light text-neutral-100">
          Add to svemir
        </h1>
        <AdminForm />
      </main>
    </>
  );
}
