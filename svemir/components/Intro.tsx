"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * First-visit entrance. A calm, EA-style card: the wordmark on a matte black
 * field with matte dots drifting inward as the explainer fades in. Opens
 * straight on the explainer (no "Enter" gate); the "Enter svemir" button then
 * plays a short cosmic swell - a real click, so browsers allow the audio - and
 * reveals the site. Shown once (localStorage), replayable from the BrandMark
 * menu via the "svemir:play-intro" event. Strictly flat/matte - NO glow.
 *
 * prefers-reduced-motion: no sound, no drift, text appears instantly.
 */

const SEEN_KEY = "svemir:intro-seen";

type Phase = "idle" | "playing" | "leaving";

type Particle = {
  left: number;
  top: number;
  size: number;
  dx: number;
  dy: number;
  peak: number;
  delay: number;
  dur: number;
};

function makeParticles(n: number): Particle[] {
  return Array.from({ length: n }, () => {
    const left = Math.random() * 100;
    const top = Math.random() * 100;
    // Drift from a point offset toward the centre of the viewport (final = 0,0).
    const towardCenterX = (50 - left) * (0.4 + Math.random() * 0.5);
    const towardCenterY = (50 - top) * (0.4 + Math.random() * 0.5);
    return {
      left,
      top,
      size: 1 + Math.random() * 2.5,
      dx: -towardCenterX * 6,
      dy: -towardCenterY * 6,
      peak: 0.2 + Math.random() * 0.4,
      delay: Math.random() * 0.6,
      dur: 2.4 + Math.random() * 1.8,
    };
  });
}

export default function Intro() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [particles, setParticles] = useState<Particle[]>([]);
  const motionRef = useRef(true);
  const audioRef = useRef<AudioContext | null>(null);

  const prefersReducedMotion = useCallback(() => {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }, []);

  // A gentle cosmic swell: a soft low chord that fades in and back out. Built
  // with oscillators so it needs no asset. Fired from the "Enter svemir" click
  // (a real user gesture, so the browser lets it play) and left to ring out over
  // its own ~3.6s envelope after the overlay closes. Autoplay is never violated.
  const playSwell = useCallback(() => {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      audioRef.current = ctx;
      const now = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, now);
      master.gain.linearRampToValueAtTime(0.11, now + 1.3);
      master.gain.linearRampToValueAtTime(0.0001, now + 3.4);
      master.connect(ctx.destination);
      // A2 + E3 + A3 - an open, calm fifth.
      const freqs = [110, 164.81, 220];
      freqs.forEach((f, i) => {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = f;
        osc.detune.value = (i - 1) * 5;
        const g = ctx.createGain();
        g.gain.value = 1 / freqs.length;
        osc.connect(g).connect(master);
        osc.start(now);
        osc.stop(now + 3.6);
      });
      window.setTimeout(() => {
        ctx.close().catch(() => {});
        if (audioRef.current === ctx) audioRef.current = null;
      }, 4000);
    } catch {
      /* audio is a nice-to-have; never block the intro on it */
    }
  }, []);

  // Open straight on the explainer (there's no title/Enter gate anymore) and
  // start the matte-dot drift. The swell fires later, on the "Enter svemir"
  // click, where a real user gesture lets the sound actually play. Defined
  // above the mount effect so it can safely sit in that effect's deps.
  const enter = useCallback(() => {
    if (motionRef.current) setParticles(makeParticles(44));
    setPhase("playing");
  }, []);

  // Decide on mount whether to show the intro; also wire the replay event.
  useEffect(() => {
    motionRef.current = !prefersReducedMotion();
    let seen = false;
    try {
      seen = localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      seen = false;
    }
    // First-visit decision reads localStorage (client-only) so it must run after
    // hydration, not during render - hence the deferred setState here. enter()
    // opens straight on the explainer (no title/Enter gate).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!seen) enter();

    function onReplay() {
      motionRef.current = !prefersReducedMotion();
      enter();
    }
    window.addEventListener("svemir:play-intro", onReplay);
    return () => window.removeEventListener("svemir:play-intro", onReplay);
  }, [prefersReducedMotion, enter]);

  const markSeen = useCallback(() => {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* private mode - the intro just replays next time, no harm */
    }
  }, []);

  const dismiss = useCallback(() => {
    markSeen();
    setPhase("leaving");
    // Let the fade-out play, then unmount the overlay.
    window.setTimeout(() => setPhase("idle"), 400);
  }, [markSeen]);

  // The explainer's primary action: play the swell (audible because it's a real
  // click) and then reveal the site. The audio is deliberately left running so
  // it rings out over the entrance rather than being cut when the overlay goes.
  const enterSite = useCallback(() => {
    if (motionRef.current) playSwell();
    dismiss();
  }, [playSwell, dismiss]);

  // Escape dismisses from any live phase.
  useEffect(() => {
    if (phase === "idle") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, dismiss]);

  // Lock background scroll while the overlay is up.
  useEffect(() => {
    if (phase === "idle") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [phase]);

  if (phase === "idle") return null;

  const playing = phase === "playing" || phase === "leaving";
  // Particles are only populated (in enter()) when motion is allowed, so their
  // presence is the render-time signal for "animate" - no ref read in render.
  const animate = playing && particles.length > 0;

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center overflow-hidden bg-black px-6 text-center ${
        phase === "leaving" ? "intro-out" : ""
      }`}
      role="dialog"
      aria-label="Welcome to Svemir"
    >
      {/* Matte drifting dots - only while playing, only if motion is allowed. */}
      {animate && (
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {particles.map((p, i) => (
            <span
              key={i}
              className="intro-particle absolute rounded-full bg-neutral-500"
              style={{
                left: `${p.left}%`,
                top: `${p.top}%`,
                width: `${p.size}px`,
                height: `${p.size}px`,
                opacity: 0,
                animationName: "intro-particle",
                animationDuration: `${p.dur}s`,
                animationDelay: `${p.delay}s`,
                animationTimingFunction: "ease-out",
                animationFillMode: "both",
                ...({
                  "--dx": `${p.dx}px`,
                  "--dy": `${p.dy}px`,
                  "--peak": `${p.peak}`,
                } as React.CSSProperties),
              }}
            />
          ))}
        </div>
      )}

      <div className="relative flex max-w-2xl flex-col items-center gap-6">
        <h1
          className={`font-[family-name:var(--font-display)] text-6xl tracking-[0.15em] text-neutral-100 sm:text-7xl ${
            animate ? "intro-word" : ""
          }`}
        >
          svemir
        </h1>

        <div
          className={animate ? "intro-text" : ""}
          style={animate ? { animationDelay: "0.7s" } : undefined}
        >
          <p className="text-[15px] leading-relaxed text-neutral-300">
            <span className="text-neutral-100">Svemir</span> (свемир) is the word
            for <span className="text-neutral-100">universe</span> in Serbian,
            Croatian, Bosnian and Montenegrin. From the roots{" "}
            <span className="italic">sve</span> (&ldquo;all&rdquo;) and{" "}
            <span className="italic">mir</span>{" "}
            (&ldquo;peace, world&rdquo;).
          </p>
          <p className="mt-3 text-sm text-neutral-500">
            My little universe of references, ideas and things I love.
          </p>
          <button
            type="button"
            onClick={enterSite}
            className="mt-7 rounded-full border border-neutral-600 px-7 py-2 text-sm text-neutral-100 transition-colors hover:bg-neutral-900"
          >
            Enter svemir →
          </button>
        </div>
      </div>
    </div>
  );
}
