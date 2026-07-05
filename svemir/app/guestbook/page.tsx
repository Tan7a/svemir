import TopBar from "@/components/TopBar";
import GuestbookForm from "@/components/GuestbookForm";
import { supabase } from "@/lib/supabase-client";
import { cardBg, rotationFor } from "@/lib/guestbook";

export const revalidate = 30;

type Entry = {
  id: string;
  name: string;
  message: string;
  color: string | null;
  sticker: string | null;
  created_at: string;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Public guestbook. Anyone can leave a personalised note; entries auto-publish
 * and render as a wall of colourful cards. Reads only the visible rows through
 * the anon client (RLS exposes `hidden = false`); writes go via the server
 * action in ./actions.ts.
 */
export default async function GuestbookPage() {
  let entries: Entry[] = [];
  if (supabase) {
    const { data } = await supabase
      .from("guestbook_entries")
      .select("id, name, message, color, sticker, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    entries = (data ?? []) as Entry[];
  }

  return (
    <>
      <TopBar />
      <main className="mx-auto min-h-[calc(100vh-3rem)] w-full max-w-5xl px-6 py-10">
        <header className="mb-8 max-w-prose">
          <h1 className="text-3xl font-light text-neutral-100">Guestbook</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-neutral-400">
            Passing through? Leave a note. Pick a colour, say hello, share a
            thought - it&rsquo;ll join the wall below.
          </p>
        </header>

        <div className="mb-12 max-w-xl">
          <GuestbookForm />
        </div>

        {entries.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No notes yet - be the first to sign.
          </p>
        ) : (
          <div className="columns-1 gap-6 sm:columns-2">
            {entries.map((e, i) => (
              <div
                key={e.id}
                style={{ backgroundColor: cardBg(e.color) }}
                className={`mb-6 break-inside-avoid rounded-md p-5 font-mono paper-note ${rotationFor(
                  i
                )}`}
              >
                <div className="mb-2 flex justify-end">
                  <span className="text-[11px] text-stone-500">
                    {formatDate(e.created_at)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#37322a]">
                  {e.message}
                </p>
                <p className="mt-4 text-right text-xs font-medium text-stone-700">
                  - {e.name?.trim() || "Anonymous"}
                </p>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
