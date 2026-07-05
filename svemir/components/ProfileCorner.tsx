"use client";

import { useState } from "react";
import { IconExternal } from "@/components/ui/icons";

/**
 * Top-right profile avatar (replaces the old "Add" button). Hovering it folds
 * the page's top-right corner down like a dog-ear (paper-corner-fold effect,
 * per the GeeksforGeeks technique — a corner triangle that grows on hover). The
 * underside of the fold is filled with the portfolio's hero colour, so the peel
 * reads as the portfolio showing through from behind. Clicking opens the
 * portfolio in a new tab. Hidden until hover.
 *
 * The fold is a fixed element but a DOM descendant of the `group` wrapper, so
 * plain CSS group-hover drives it (hovering the avatar OR the fold keeps it
 * open). Avatar asset: /public/me.jpg (falls back to "T").
 */

const PORTFOLIO = "https://tanjaradovanovic.com/";
const AVATAR_SRC = "/me.jpeg";
// Revealed corner (what's "behind" the page) = portfolio hero colour.
// Placeholder until Tanja gives the exact hero hex.
const PEEL_HERO = "#e7dcc8";
// Backside of the folded page flap. The flap is lit as if the (light) portfolio
// page behind it is shining onto the crease: darkest at the folded tip
// (bottom-left), lightest along the fold line (the diagonal crease). The extra
// mid stop bends the shading so the paper reads as gently *curved*, not flat -
// that curvature + the wide dark→light range is what sells the 3D lift.
const DARK_TIP = "#141417";
const MID_FOLD = "#3a3a44";
const LIGHT_CREASE = "#70707e";
// Two triangles that share the diagonal fold line: the corner reveal (top-right
// half) and the folded-over page flap (bottom-left half).
const REVEAL = "polygon(100% 0, 0 0, 100% 100%)";
const FLAP = "polygon(0 0, 100% 100%, 0 100%)";

export default function ProfileCorner() {
  const [avatarOk, setAvatarOk] = useState(true);

  return (
    <div className="group relative ml-2 inline-flex">
      {/* Avatar in the top bar. */}
      <a
        href={PORTFOLIO}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open Tanja's portfolio"
        className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-neutral-700 bg-neutral-800 text-xs font-semibold text-neutral-200 transition-colors hover:border-neutral-500"
      >
        {avatarOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={AVATAR_SRC}
            alt="Tanja"
            className="h-full w-full object-cover"
            onError={() => setAvatarOk(false)}
          />
        ) : (
          "T"
        )}
      </a>

      {/* The page-corner fold. 0×0 (hidden) until the group is hovered, then it
          grows into a triangle in the very corner of the viewport. */}
      <a
        href={PORTFOLIO}
        target="_blank"
        rel="noopener noreferrer"
        aria-hidden="true"
        tabIndex={-1}
        className="pointer-events-none fixed right-0 top-0 z-50 h-0 w-0 transition-[width,height] duration-500 ease-out group-hover:pointer-events-auto group-hover:h-40 group-hover:w-40"
      >
        {/* Revealed corner - the portfolio showing through behind the page.
            A soft shadow along the fold line makes the flap read as lifted. */}
        <span
          aria-hidden
          className="absolute right-0 top-0 h-full w-full"
          style={{
            clipPath: REVEAL,
            // Deeper shadow the flap casts onto the revealed page, right along
            // the crease - the contrast against the lit flap reads as depth.
            background: `linear-gradient(135deg, rgba(0,0,0,0.45), transparent 46%), ${PEEL_HERO}`,
          }}
        />
        {/* Folded-over page corner (the flap): the page's backside turned down
            along the diagonal, with a crease sheen + drop-shadow so it lifts. */}
        <span
          aria-hidden
          className="absolute right-0 top-0 h-full w-full"
          style={{
            clipPath: FLAP,
            // 45deg = toward the top-right: dark at the bottom-left tip, through
            // a mid tone, to the bright crease - a curved, high-contrast fold.
            background: `linear-gradient(45deg, ${DARK_TIP} 0%, ${MID_FOLD} 52%, ${LIGHT_CREASE} 100%)`,
            filter: "drop-shadow(-9px 9px 8px rgba(0,0,0,0.6))",
          }}
        />
        {/* Label so visitors know where the corner leads. */}
        <span
          className="pointer-events-none absolute right-5 top-3.5 inline-flex items-center gap-1 whitespace-nowrap font-sans text-sm font-medium opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{ color: "#3a352b" }}
        >
          Peek inside
          <IconExternal size={13} />
        </span>
      </a>
    </div>
  );
}
