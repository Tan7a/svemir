"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signGuestbook } from "@/app/guestbook/actions";
import {
  GUESTBOOK_COLORS,
  GUESTBOOK_STYLES,
  DEFAULT_COLOR,
  DEFAULT_STYLE,
  cardBg,
  styleClass,
} from "@/lib/guestbook";
import Chevron from "@/components/ui/Chevron";
import { IconSend } from "@/components/ui/icons";

/**
 * Public sign-the-guestbook form, styled as a piece of paper. The visitor
 * writes in a handwritten script (Caveat), picks a warm paper colour, and
 * chooses a paper "style" (lined / grid / torn / taped) with the `< Style >`
 * switcher - both are saved with the note and shown on the wall. Submits through
 * the `signGuestbook` server action (validates + rate-limits), then refreshes.
 */
export default function GuestbookForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [style, setStyle] = useState(DEFAULT_STYLE);
  const [website, setWebsite] = useState(""); // honeypot
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const styleIndex = GUESTBOOK_STYLES.findIndex((s) => s.key === style);
  const currentStyle = GUESTBOOK_STYLES[styleIndex] ?? GUESTBOOK_STYLES[0];
  function cycleStyle(dir: 1 | -1) {
    const next =
      (styleIndex + dir + GUESTBOOK_STYLES.length) % GUESTBOOK_STYLES.length;
    setStyle(GUESTBOOK_STYLES[next].key);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await signGuestbook({
        name,
        message,
        color,
        style,
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
        className={`paper-note ${styleClass(style)} col-span-2 flex min-h-[18rem] flex-col items-center justify-center rounded-md p-4 text-center sm:col-span-1 sm:aspect-[4/5] sm:min-h-0`}
      >
        <p className="font-[family-name:var(--font-hand)] text-2xl text-[#37322a]">
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
      className={`paper-note ${styleClass(style)} relative col-span-2 flex min-h-[18rem] flex-col rounded-md p-4 sm:col-span-1 sm:aspect-[4/5] sm:min-h-0`}
    >
      {/* Message - written directly on the paper in handwriting, no box, no limit. */}
      <textarea
        placeholder="Say hello, leave a thought, or a line that stayed with you…"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        aria-label="Your message"
        rows={4}
        className="w-full min-h-0 flex-1 resize-none bg-transparent font-[family-name:var(--font-hand)] text-xl leading-snug text-[#37322a] placeholder:text-stone-500/70 focus:outline-none"
      />

      {/* Signature - optional. */}
      <input
        type="text"
        placeholder="- your name (optional)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Your name (optional)"
        className="mt-2 w-full bg-transparent font-[family-name:var(--font-hand)] text-lg text-[#37322a] placeholder:text-stone-500/70 focus:outline-none"
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

      {/* Quiet toolbar along the bottom of the paper: colours, style, submit. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-stone-500/25 pt-3">
        <div className="flex items-center gap-1.5">
          {GUESTBOOK_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-label={c.key}
              aria-pressed={color === c.key}
              onClick={() => setColor(c.key)}
              style={{ backgroundColor: c.paper }}
              className={`h-5 w-5 rounded-full border border-black/10 transition-transform hover:scale-110 ${
                color === c.key
                  ? "ring-2 ring-stone-700 ring-offset-1 ring-offset-white/40"
                  : ""
              }`}
            />
          ))}
        </div>

        {/* Paper-style switcher - cycles lined / grid / torn / taped. */}
        <div className="flex items-center gap-1 rounded-full bg-white/70 px-1 py-0.5 text-stone-700">
          <button
            type="button"
            aria-label="Previous style"
            onClick={() => cycleStyle(-1)}
            className="flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-black/5"
          >
            <Chevron className="rotate-90" />
          </button>
          <span className="min-w-[3.25rem] text-center text-xs font-medium">
            {currentStyle.label}
          </span>
          <button
            type="button"
            aria-label="Next style"
            onClick={() => cycleStyle(1)}
            className="flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-black/5"
          >
            <Chevron className="-rotate-90" />
          </button>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="ml-auto flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-medium text-stone-800 shadow-sm transition-colors hover:bg-stone-50 disabled:opacity-60"
        >
          <IconSend size={14} />
          {pending ? "Signing…" : "Submit"}
        </button>
      </div>
    </form>
  );
}
