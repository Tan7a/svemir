import TopBar from "@/components/TopBar";
import AdminTabs from "@/components/AdminTabs";
import GuestbookAdminList, {
  type AdminEntry,
} from "@/components/GuestbookAdminList";
import { supabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * Admin moderation for the guestbook. Lists every entry (including hidden ones)
 * via the service-role client so Tanja can hide or delete notes. Gated by the
 * /admin Basic Auth proxy; the mutating actions re-check isAuthed themselves.
 */
export default async function AdminGuestbookPage() {
  let entries: AdminEntry[] = [];
  if (supabaseAdmin) {
    const { data } = await supabaseAdmin
      .from("guestbook_entries")
      .select("id, name, message, color, sticker, hidden, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    entries = (data ?? []) as AdminEntry[];
  }

  return (
    <>
      <TopBar />
      <AdminTabs active="guestbook" />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="mb-1 text-2xl font-light text-neutral-100">Guestbook</h1>
        <p className="mb-6 text-sm text-neutral-500">
          {entries.length} entr{entries.length === 1 ? "y" : "ies"} · hide to pull
          from the public wall, or delete permanently.
        </p>
        {supabaseAdmin ? (
          <GuestbookAdminList entries={entries} />
        ) : (
          <p className="text-sm text-neutral-400">Supabase admin is not configured.</p>
        )}
      </main>
    </>
  );
}
