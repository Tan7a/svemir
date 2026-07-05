"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signGuestbook } from "@/app/guestbook/actions";
import { GUESTBOOK_COLORS, DEFAULT_COLOR, cardBg } from "@/lib/guestbook";

/**
 * Public sign-the-guestbook form, styled as a piece of paper (monospace
 * "typewriter" ink on the `.paper-note` surface). No character limits; the name
 * is optional. Personalise with a colour - the chosen colour tints the whole
 * note. Submits through the `signGuestbook` server action (validates +
 * rate-limits), then refreshes the wall.
 */
export default function GuestbookForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [website, setWebsite] = useState(""); // honeypot
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await signGuestbook({
        name,
        message,
        color,
        sticker: "",
        website,
      });
      if (res.success) {
        setDone(true);
        setName("");
        setMessage("");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  if (done) {
    return (
      <div
        style={{ backgroundColor: cardBg(color) }}
        className="paper-note -rotate-1 rounded-md p-6 text-center font-mono"
      >
        <p className="text-sm text-[#37322a]">
          Thanks for signing - your note is on the wall.
        </p>
        <button
          type="button"
          onClick={() => setDone(false)}
          className="mt-3 text-xs underline underline-offset-2 opacity-70 hover:opacity-100"
        >
          Leave another
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      style={{ backgroundColor: cardBg(color) }}
      className="paper-note relative flex min-h-[16rem] -rotate-1 flex-col rounded-md p-6 font-mono"
    >
      {/* Message - written directly on the paper, no box, no limit. */}
      <textarea
        placeholder="Leave a message, write a poem, draw some ASCII art…"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        aria-label="Your message"
        rows={4}
        className="w-full flex-1 resize-none bg-transparent text-base leading-relaxed text-[#37322a] placeholder:text-stone-500/80 focus:outline-none"
      />

      {/* Signature - optional. */}
      <input
        type="text"
        placeholder="- your name (optional)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Your name (optional)"
        className="mt-2 w-full bg-transparent text-sm font-medium text-[#37322a] placeholder:text-stone-500/80 focus:outline-none"
      />

      {/* Honeypot - hidden from humans, catnip for bots. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        className="hidden"
        aria-hidden
      />

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      {/* Quiet toolbar along the bottom of the paper. */}
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-stone-500/25 pt-4">
        <div className="flex items-center gap-1.5">
          {GUESTBOOK_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-label={c.key}
              aria-pressed={color === c.key}
              onClick={() => setColor(c.key)}
              className={`h-5 w-5 rounded-full ${c.swatch} transition-transform hover:scale-110 ${
                color === c.key
                  ? "ring-2 ring-stone-700 ring-offset-1 ring-offset-white/40"
                  : ""
              }`}
            />
          ))}
        </div>
        <button
          type="submit"
          disabled={pending}
          className="ml-auto rounded-full bg-stone-800 px-4 py-2 text-sm font-medium text-[#f4ecd6] transition-colors hover:bg-stone-900 disabled:opacity-60"
        >
          {pending ? "Signing…" : "Sign guestbook"}
        </button>
      </div>
    </form>
  );
}
