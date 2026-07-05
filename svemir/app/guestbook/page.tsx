import TopBar from "@/components/TopBar";
import GuestbookForm from "@/components/GuestbookForm";
import { supabase } from "@/lib/supabase-client";
import { cardBg, styleClass } from "@/lib/guestbook";

export const revalidate = 30;

type Entry = {
  id: string;
  name: string;
  message: string;
  color: string | null;
  style: string | null;
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
      .select("id, name, message, color, style, sticker, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    entries = (data ?? []) as Entry[];
  }

  return (
    <>
      <TopBar />
      {/* Full-width, left-aligned to the same gutter as Blocks / Research /
          Design (px-5 sm:px-8), with the same display-title header. */}
      <main className="min-h-[calc(100vh-3rem)] w-full px-5 py-10 sm:px-8">
        <header className="mb-8 max-w-prose">
          <h1 className="font-[family-name:var(--font-display)] text-5xl tracking-wider text-neutral-100">
            Guestbook
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-neutral-300">
            Passing through? Leave a note. Pick a colour, say hello, share a
            thought - it&rsquo;ll join the wall below.
          </p>
        </header>

        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {/* The composer is the first note in the wall - same shape as the
              rest, just editable. */}
          <GuestbookForm />
          {entries.map((e) => (
            <div
              key={e.id}
              style={{ backgroundColor: cardBg(e.color) }}
              className={`paper-note ${styleClass(
                e.style,
              )} relative flex aspect-[4/5] flex-col rounded-md p-4`}
            >
              <span className="self-end text-[11px] text-stone-500">
                {formatDate(e.created_at)}
              </span>
              {/* Message fills the card; long notes fade out at the foot
                    rather than blowing past the ~3:4 shape. */}
              <div className="mt-1 min-h-0 flex-1 overflow-hidden [mask-image:linear-gradient(to_bottom,#000_72%,transparent)]">
                <p className="whitespace-pre-wrap font-[family-name:var(--font-hand)] text-xl leading-snug text-[#37322a]">
                  {e.message}
                </p>
              </div>
              <p className="mt-2 text-right font-[family-name:var(--font-hand)] text-lg font-medium text-stone-700">
                - {e.name?.trim() || "Anonymous"}
              </p>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
