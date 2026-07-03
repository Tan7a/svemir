"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Button from "./ui/Button";
import ConfirmDialog from "./ui/ConfirmDialog";
import {
  setGuestbookHidden,
  deleteGuestbookEntry,
} from "@/app/admin/guestbook/actions";
import { accentDot } from "@/lib/guestbook";

export type AdminEntry = {
  id: string;
  name: string;
  message: string;
  color: string | null;
  sticker: string | null;
  hidden: boolean;
  created_at: string;
};

/**
 * Admin moderation list for the guestbook. Each row can be hidden (soft - keeps
 * the row but removes it from the public wall) or deleted (permanent, confirmed
 * via ConfirmDialog). Actions run through the guarded server actions and refresh
 * the list on success.
 */
export default function GuestbookAdminList({ entries }: { entries: AdminEntry[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function toggleHidden(e: AdminEntry) {
    startTransition(async () => {
      await setGuestbookHidden(e.id, !e.hidden);
      router.refresh();
    });
  }

  function confirmDelete() {
    if (!confirmId) return;
    const id = confirmId;
    setConfirmId(null);
    startTransition(async () => {
      await deleteGuestbookEntry(id);
      router.refresh();
    });
  }

  if (entries.length === 0) {
    return <p className="text-sm text-neutral-500">No guestbook entries yet.</p>;
  }

  return (
    <>
      <ul className="flex flex-col gap-3">
        {entries.map((e) => (
          <li
            key={e.id}
            className={`flex items-start gap-4 rounded-md p-4 font-mono paper-note ${
              e.hidden ? "opacity-50" : ""
            }`}
          >
            <span className="text-xl" aria-hidden>
              {e.sticker ?? "💬"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-wrap text-sm text-[#37322a]">
                {e.message}
              </p>
              <p className="mt-2 flex items-center gap-2 text-xs text-stone-700">
                <span className={`h-2 w-2 rounded-full ${accentDot(e.color)}`} aria-hidden />
                - {e.name?.trim() || "Anonymous"} ·{" "}
                <span className="text-stone-500">
                  {new Date(e.created_at).toLocaleString()}
                </span>
                {e.hidden && (
                  <span className="ml-2 rounded-full border border-neutral-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
                    hidden
                  </span>
                )}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => toggleHidden(e)}
              >
                {e.hidden ? "Show" : "Hide"}
              </Button>
              <Button
                variant="secondary"
                disabled={pending}
                className="text-red-400 hover:bg-red-950/50"
                onClick={() => setConfirmId(e.id)}
              >
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={confirmId !== null}
        tone="danger"
        title="Delete this note?"
        message="This permanently removes the guestbook entry. This can't be undone."
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setConfirmId(null)}
      />
    </>
  );
}
