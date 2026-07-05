"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { BlockWithChannelTags, ChannelWithBlocks } from "@/lib/types";
import { THEMES, getTheme, setTheme, type ThemeId } from "@/lib/themes";
import Button from "@/components/ui/Button";
import Pill from "@/components/ui/Pill";
import TextInput from "@/components/ui/TextInput";
import Chevron from "@/components/ui/Chevron";
import SelectionCircle from "@/components/ui/SelectionCircle";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { MenuPanel, MenuItem, MenuDivider, MenuLabel } from "@/components/ui/Menu";
import {
  IconEye,
  IconEdit,
  IconTrash,
  IconDownload,
  IconInfo,
  IconFolder,
  IconShare,
  IconCopy,
  IconPlus,
  IconArchive,
  IconDuplicate,
  IconPin,
  IconBell,
  IconSort,
  IconGrid,
  IconList,
  IconExpand,
  IconUndo,
  IconRedo,
  IconSave,
  IconHome,
  IconLogout,
  IconCheckSquare,
  IconDropdownCircle,
  IconExternal,
  IconRefresh,
  IconStar,
} from "@/components/ui/icons";
import BlockCard from "@/components/BlockCard";
import ChannelCard from "@/components/ChannelCard";
import { GUESTBOOK_STYLES, GUESTBOOK_COLORS, cardBg } from "@/lib/guestbook";

/* ---------------------------------------------------------------------------
   Side-nav map - every group + component, mirrored by ids on the sections
   below. Clicking scrolls to the target; the page stays a single scroll.
   --------------------------------------------------------------------------- */

const NAV = [
  { label: "Principles", id: "principles", items: [] as { label: string; id: string }[] },
  {
    label: "Foundations",
    id: "foundations",
    items: [
      { label: "Brand", id: "f-brand" },
      { label: "Colour", id: "f-color-ramp" },
      { label: "Typography", id: "f-type" },
      { label: "Spacing", id: "f-spacing" },
      { label: "Radius", id: "f-radius" },
      { label: "Elevation", id: "f-elevation" },
      { label: "Layering", id: "f-layering" },
      { label: "Motion", id: "f-motion" },
    ],
  },
  {
    label: "Atoms",
    id: "atoms",
    items: [
      { label: "Button", id: "a-button" },
      { label: "Pill", id: "a-pill" },
      { label: "TextInput", id: "a-input" },
      { label: "Chevron", id: "a-chevron" },
      { label: "SelectionCircle", id: "a-selection" },
      { label: "Icons", id: "a-icon" },
      { label: "Status text", id: "a-status" },
    ],
  },
  {
    label: "Molecules",
    id: "molecules",
    items: [
      { label: "Menu", id: "m-menu" },
      { label: "Tag list", id: "m-taglist" },
      { label: "Action row", id: "m-actionrow" },
      { label: "Dialog", id: "m-dialog" },
    ],
  },
  {
    label: "Organisms",
    id: "organisms",
    items: [
      { label: "BlockCard", id: "o-blockcard" },
      { label: "ChannelCard", id: "o-channelcard" },
      { label: "Guestbook note", id: "o-guestbook" },
      { label: "Other", id: "o-other" },
    ],
  },
  { label: "How it's built", id: "build", items: [] as { label: string; id: string }[] },
];

const ADOPTED = [
  "Menu",
  "Button",
  "Pill",
  "TextInput",
  "SelectionCircle",
  "Chevron",
  "Dialog",
  "ConfirmDialog",
];

const MIGRATING = ["AdminForm", "SignInModal", "ChannelPicker", "PaperDetail"];

/* ---------------------------------------------------------------------------
   Layout helpers
   --------------------------------------------------------------------------- */

function SideNav() {
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    const ids = NAV.flatMap((g) => [g.id, ...g.items.map((i) => i.id)]);
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  function go(e: React.MouseEvent, id: string) {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
  }

  return (
    <nav className="sticky top-16 hidden h-max w-44 shrink-0 lg:block">
      <ul className="flex flex-col gap-4 text-sm">
        {NAV.map((g) => (
          <li key={g.id}>
            <a
              href={`#${g.id}`}
              onClick={(e) => go(e, g.id)}
              className={`block font-medium transition-colors ${
                active === g.id
                  ? "text-neutral-100"
                  : "text-neutral-300 hover:text-neutral-100"
              }`}
            >
              {g.label}
            </a>
            {g.items.length > 0 && (
              <ul className="mt-1.5 flex flex-col gap-1 border-l border-neutral-800 pl-3">
                {g.items.map((it) => (
                  <li key={it.id}>
                    <a
                      href={`#${it.id}`}
                      onClick={(e) => go(e, it.id)}
                      className={`block text-[13px] transition-colors ${
                        active === it.id
                          ? "text-neutral-100"
                          : "text-neutral-500 hover:text-neutral-200"
                      }`}
                    >
                      {it.label}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-neutral-900 pt-10">
      <h2 className="text-xl font-light text-neutral-100">{title}</h2>
      {intro && <p className="mt-1 max-w-2xl text-sm text-neutral-500">{intro}</p>}
      <div className="mt-6 flex flex-col gap-8">{children}</div>
    </section>
  );
}

/** A single documented entry: name, when-to-use, a live example, and the recipe. */
function Spec({
  id,
  name,
  usage,
  recipe,
  children,
}: {
  id: string;
  name: string;
  usage?: string;
  recipe?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      id={id}
      className="scroll-mt-24 rounded-2xl border border-neutral-800 bg-background"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-900 px-5 py-3">
        <span className="text-sm font-medium text-neutral-200">{name}</span>
        {usage && <span className="text-xs text-neutral-500">{usage}</span>}
      </div>
      <div className="flex min-h-[72px] flex-wrap items-center gap-4 p-5">
        {children}
      </div>
      {recipe && (
        <code className="block overflow-x-auto border-t border-neutral-900 px-5 py-2.5 font-mono text-[11px] leading-relaxed text-neutral-500">
          {recipe}
        </code>
      )}
    </div>
  );
}

/** A colour chip that reads its live value from the active theme's CSS var. */
function Swatch({ varName, label }: { varName: string; label: string }) {
  const [hex, setHex] = useState("");
  useEffect(() => {
    // Read the resolved token value from the DOM after mount (grids remount via
    // a theme key). Legitimate external→React sync, not a render loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHex(
      getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
    );
  }, [varName]);
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="h-14 w-full rounded-xl border border-neutral-800"
        style={{ background: `var(${varName})` }}
      />
      <span className="text-[11px] text-neutral-300">{label}</span>
      <span className="font-mono text-[10px] uppercase text-neutral-500">
        {hex || "·"}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Fixed mock data for the organism examples - no remote images, no network.
   --------------------------------------------------------------------------- */

const FIXED_DATE = "2026-01-01T00:00:00.000Z";

function mockBlock(over: Partial<BlockWithChannelTags>): BlockWithChannelTags {
  return {
    id: "ds-block",
    url: null,
    title: "Untitled",
    description: null,
    image_url: null,
    source_name: null,
    source_handle: null,
    source_type: "manual",
    categories: [],
    notes: null,
    kind: "text",
    body_text: null,
    created_at: FIXED_DATE,
    paper_authors: null,
    paper_year: null,
    channels: [],
    ...over,
  };
}

const demoTextBlock = mockBlock({
  id: "ds-text",
  kind: "text",
  title: "Design that inspires",
  description: "A text block shows its body when there's no image.",
  source_name: "svemir.space",
  channels: [
    { slug: "design", title: "Design" },
    { slug: "inspiration", title: "Inspiration" },
  ],
});

const demoPaperBlock = mockBlock({
  id: "ds-paper",
  kind: "paper",
  title: "User Experience: A Research Agenda",
  description:
    "Papers lead with metadata at rest: title, authors, year, and abstract.",
  paper_authors: ["Hassenzahl", "Tractinsky"],
  paper_year: 2006,
  channels: [{ slug: "research-papers", title: "Research Papers" }],
});

const demoChannel: ChannelWithBlocks & { last_connected_at?: string | null } = {
  id: "ds-channel",
  slug: "design",
  title: "Design",
  description: "Things that inspire.",
  cover_url: null,
  parent_id: null,
  created_at: FIXED_DATE,
  block_count: 12,
  last_connected_at: null,
  blocks: [
    { ...demoTextBlock, id: "ds-ch-1" },
    { ...demoPaperBlock, id: "ds-ch-2" },
    { ...demoTextBlock, id: "ds-ch-3" },
    { ...demoPaperBlock, id: "ds-ch-4" },
  ],
};

/* ---------------------------------------------------------------------------
   Static token data
   --------------------------------------------------------------------------- */

const NEUTRALS = [
  50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950,
] as const;

const SEMANTIC = [
  { varName: "--background", label: "background" },
  { varName: "--foreground", label: "foreground" },
  { varName: "--muted", label: "muted" },
  { varName: "--border", label: "border" },
  { varName: "--card-hover", label: "card-hover" },
  { varName: "--selection-bg", label: "selection-bg" },
  { varName: "--selection-fg", label: "selection-fg" },
];

const RADII = [
  { cls: "rounded-xl", label: "xl floor · controls, inputs, menus, tiles" },
  { cls: "rounded-2xl", label: "2xl · dialogs, spec cards" },
  { cls: "rounded-3xl", label: "3xl · cards" },
  { cls: "rounded-full", label: "full · pills, circles, dots" },
];

const SPACING = [
  { token: "0.5", px: 2 },
  { token: "1", px: 4 },
  { token: "1.5", px: 6 },
  { token: "2", px: 8 },
  { token: "3", px: 12 },
  { token: "4", px: 16 },
  { token: "5", px: 20 },
  { token: "6", px: 24 },
];

const LAYERS = [
  { z: "z-10", label: "content · stretched links, card overlays" },
  { z: "z-20", label: "menus / panels" },
  { z: "z-30", label: "top bar" },
  { z: "z-40", label: "dropdowns · floating bar" },
  { z: "z-50", label: "modals · dialogs" },
];

const PRINCIPLES = [
  {
    title: "Token-first",
    body: "Every value is a CSS variable. Components never hardcode a hex, so all four themes work for free: restyle the tokens, not the components.",
  },
  {
    title: "Monochrome + one accent",
    body: "A single neutral ramp carries the whole UI. Colour is earned: red is reserved for destructive actions, nothing else competes with the imagery.",
  },
  {
    title: "Quiet by default",
    body: "Image-forward and calm at rest. Context (titles, sources, actions) fades in on hover instead of crowding the wall of references.",
  },
  {
    title: "Harmonized geometry",
    body: "One radius floor (xl), one spacing rhythm, one elevation and layering ladder. Consistency is the system; primitives make it repeatable.",
  },
];

const ICONS: { label: string; node: React.ReactNode; flero?: boolean }[] = [
  { label: "search / view", node: <IconEye size={18} />, flero: true },
  { label: "edit", node: <IconEdit size={18} />, flero: true },
  { label: "download", node: <IconDownload size={18} />, flero: true },
  { label: "folder", node: <IconFolder size={18} />, flero: true },
  { label: "info", node: <IconInfo size={18} />, flero: true },
  { label: "share", node: <IconShare size={18} />, flero: true },
  { label: "copy", node: <IconCopy size={18} />, flero: true },
  { label: "duplicate", node: <IconDuplicate size={18} />, flero: true },
  { label: "trash", node: <IconTrash size={18} />, flero: true },
  { label: "archive", node: <IconArchive size={18} />, flero: true },
  { label: "plus", node: <IconPlus size={18} />, flero: true },
  { label: "pin", node: <IconPin size={18} />, flero: true },
  { label: "bell", node: <IconBell size={18} />, flero: true },
  { label: "sort", node: <IconSort size={18} />, flero: true },
  { label: "grid", node: <IconGrid size={18} />, flero: true },
  { label: "list", node: <IconList size={18} />, flero: true },
  { label: "expand", node: <IconExpand size={18} />, flero: true },
  { label: "undo", node: <IconUndo size={18} />, flero: true },
  { label: "redo", node: <IconRedo size={18} />, flero: true },
  { label: "save", node: <IconSave size={18} />, flero: true },
  { label: "home", node: <IconHome size={18} />, flero: true },
  { label: "logout", node: <IconLogout size={18} />, flero: true },
  { label: "check", node: <IconCheckSquare size={18} />, flero: true },
  { label: "dropdown", node: <IconDropdownCircle size={18} />, flero: true },
  { label: "external", node: <IconExternal size={18} /> },
  { label: "refresh", node: <IconRefresh size={18} /> },
  { label: "star", node: <IconStar size={18} /> },
];

/* ---------------------------------------------------------------------------
   Catalogue
   --------------------------------------------------------------------------- */

export default function DesignSystemCatalogue() {
  const [theme, setThemeState] = useState<ThemeId>("dark");
  const [menuOpen, setMenuOpen] = useState(true);
  const [selected, setSelected] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Sync the initial theme from <html data-theme> after mount - SSR defaults to
  // "dark", so reading during render would cause a hydration mismatch.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setThemeState(getTheme()), []);

  function chooseTheme(id: ThemeId) {
    setTheme(id);
    setThemeState(id);
  }

  return (
    <div className="flex flex-col gap-10 pb-24">
      {/* Header + live theme switcher */}
      <header className="flex flex-col gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-5xl tracking-wider text-neutral-100">
            Design system
          </h1>
          <div className="mt-2 flex max-w-[450px] flex-col gap-3 text-sm leading-relaxed text-neutral-500">
            <p>
              svemir is my personal universe of references: blocks, channels, a
              knowledge graph, and a research layer for papers.
            </p>
            <p>
              This is the system it runs on. A tight set of primitives sits over
              a single token layer, so nothing is hardcoded and every screen
              re-themes on command. Change one token and the whole product
              follows. Everything below is the real code, composed atoms to
              organisms.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs uppercase tracking-wide text-neutral-500">
            Theme
          </span>
          <div className="flex flex-wrap gap-1.5">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => chooseTheme(t.id)}
                className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                  theme === t.id
                    ? "bg-neutral-100 text-neutral-900"
                    : "border border-neutral-700 text-neutral-300 hover:bg-neutral-900"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Sticky side-nav + single-scroll content */}
      <div className="flex gap-10">
        <SideNav />

        <div className="flex min-w-0 flex-1 flex-col gap-10">
          {/* PRINCIPLES */}
          <Section
            id="principles"
            title="Principles"
            intro="The four rules the rest of the system falls out of."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {PRINCIPLES.map((p, i) => (
                <div
                  key={p.title}
                  className="rounded-2xl border border-neutral-800 bg-background p-5"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-neutral-700 text-[11px] text-neutral-400">
                      {i + 1}
                    </span>
                    <span className="text-sm font-medium text-neutral-100">
                      {p.title}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-neutral-400">
                    {p.body}
                  </p>
                </div>
              ))}
            </div>
          </Section>

          {/* FOUNDATIONS */}
          <Section
            id="foundations"
            title="Foundations"
            intro="Tokens, not hardcoded values. Only the neutral ramp + semantic tokens, so the 4 themes keep working."
          >
            <Spec
              id="f-brand"
              name="Brand"
              usage="wordmark + Bebas Neue display type"
              recipe='logo: /svemir.svg · display: font-[family-name:var(--font-display)] / font-display'
            >
              <div className="flex flex-wrap items-center gap-6">
                <div
                  className="flex h-20 w-40 items-center justify-center rounded-xl border border-neutral-800"
                  style={{ background: "#0a0a0a" }}
                >
                  <Image
                    src="/svemir.svg"
                    alt="svemir logo"
                    width={96}
                    height={31}
                    className="h-auto w-24"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span
                    className="text-5xl tracking-wider text-neutral-100"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    SVEMIR
                  </span>
                  <span className="text-xs text-neutral-500">
                    Bebas Neue · display / headings · uppercase, wide tracking
                  </span>
                </div>
              </div>
            </Spec>

            <Spec
              id="f-color-ramp"
              name="Colour · neutral ramp"
              usage="neutral-50 … 950 (inverts per theme to preserve contrast pairs)"
            >
              <div
                key={`ramp-${theme}`}
                className="grid w-full grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-11"
              >
                {NEUTRALS.map((n) => (
                  <Swatch
                    key={n}
                    varName={`--color-neutral-${n}`}
                    label={`neutral-${n}`}
                  />
                ))}
              </div>
            </Spec>

            <Spec
              id="f-color-semantic"
              name="Colour · semantic tokens"
              usage="surface / text / chrome roles"
            >
              <div
                key={`sem-${theme}`}
                className="grid w-full grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-7"
              >
                {SEMANTIC.map((s) => (
                  <Swatch key={s.varName} varName={s.varName} label={s.label} />
                ))}
              </div>
            </Spec>

            <Spec
              id="f-type"
              name="Typography"
              usage="Bebas Neue (display) · Inter (text), ss01/cv11 · Caveat (handwriting)"
              recipe="display: font-display uppercase tracking-wider · headings: text-2xl/text-lg font-light · body: text-sm · meta: text-xs · labels: text-[10px] uppercase tracking-wide · handwriting: font-[family-name:var(--font-hand)] / Caveat (guestbook notes only)"
            >
              <div className="flex flex-col gap-2">
                <span
                  className="text-3xl tracking-wider text-neutral-100"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  Display · Bebas Neue
                </span>
                <span className="text-2xl font-light text-neutral-100">
                  Heading · Inter text-2xl font-light
                </span>
                <span className="text-sm text-neutral-200">
                  Body · text-sm text-neutral-200
                </span>
                <span className="text-xs text-neutral-500">
                  Meta · text-xs text-neutral-500
                </span>
                <span className="text-[10px] uppercase tracking-wide text-neutral-500">
                  Label · text-[10px] uppercase tracking-wide
                </span>
                <span
                  className="text-2xl text-neutral-100"
                  style={{ fontFamily: "var(--font-hand)" }}
                >
                  Handwriting · Caveat · guestbook notes
                </span>
              </div>
            </Spec>

            <Spec
              id="f-spacing"
              name="Spacing"
              usage="a 4px rhythm (with 2/6px half-steps)"
            >
              <div className="flex w-full flex-col gap-2">
                {SPACING.map((s) => (
                  <div key={s.token} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 font-mono text-[11px] text-neutral-500">
                      gap/p-{s.token} · {s.px}px
                    </span>
                    <div
                      className="h-3 rounded-full bg-neutral-700"
                      style={{ width: `${s.px * 4}px` }}
                    />
                  </div>
                ))}
              </div>
            </Spec>

            <Spec
              id="f-radius"
              name="Radius"
              usage="floor harmonized to xl · md/lg/sm retired"
              recipe="rounded-xl (floor) · rounded-2xl · rounded-3xl · rounded-full"
            >
              {RADII.map((r) => (
                <div key={r.cls} className="flex flex-col items-center gap-2">
                  <div
                    className={`h-14 w-14 border border-neutral-700 bg-neutral-900 ${r.cls}`}
                  />
                  <span className="max-w-[8rem] text-center text-[10px] text-neutral-500">
                    {r.label}
                  </span>
                </div>
              ))}
            </Spec>

            <Spec
              id="f-elevation"
              name="Elevation"
              usage="shadow-xl (light) · shadow-2xl shadow-black/60 (overlays)"
            >
              <div className="flex h-16 w-32 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-xs text-neutral-400 shadow-xl">
                shadow-xl
              </div>
              <div className="flex h-16 w-32 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-xs text-neutral-400 shadow-2xl shadow-black/60">
                shadow-2xl
              </div>
            </Spec>

            <Spec
              id="f-layering"
              name="Layering"
              usage="the z-index ladder · one rung per surface kind"
            >
              <div className="flex w-full flex-col gap-1.5">
                {LAYERS.map((l) => (
                  <div key={l.z} className="flex items-center gap-3">
                    <span className="w-14 shrink-0 font-mono text-[11px] text-neutral-300">
                      {l.z}
                    </span>
                    <span className="text-xs text-neutral-500">{l.label}</span>
                  </div>
                ))}
              </div>
            </Spec>

            <Spec
              id="f-motion"
              name="Motion"
              usage="panel-in (side panel) · dialog-in (centered)"
              recipe="animation: panel-in 0.2s ease-out · dialog-in 0.18s ease-out · transition-colors on interactive states"
            >
              <MotionDemo />
            </Spec>
          </Section>

          {/* ATOMS */}
          <Section
            id="atoms"
            title="Atoms"
            intro="Single-purpose elements. These render the real components/ui primitives."
          >
            <Spec
              id="a-button"
              name="Button"
              usage="variant: primary | secondary | icon"
              recipe='<Button variant="primary">Save</Button>'
            >
              <Button variant="primary">Save</Button>
              <Button variant="secondary">Connect →</Button>
              <Button variant="secondary" disabled>
                Disabled
              </Button>
              <Button variant="icon" aria-label="Close">
                ×
              </Button>
            </Spec>

            <Spec
              id="a-pill"
              name="Pill"
              usage="channel / category / theme tag"
              recipe="<Pill>Design</Pill> · px-2 py-1 rounded-full"
            >
              <Pill>Design</Pill>
              <Pill>Inspiration</Pill>
              <Pill>Research Papers</Pill>
            </Spec>

            <Spec
              id="a-input"
              name="TextInput"
              usage="size: default | small"
              recipe='<TextInput placeholder="…" /> · <TextInput size="small" />'
            >
              <div className="w-56">
                <TextInput placeholder="Default input" />
              </div>
              <div className="w-56">
                <TextInput size="small" placeholder="Small (picker) input" />
              </div>
            </Spec>

            <Spec
              id="a-chevron"
              name="Chevron"
              usage="dropdown affordance; rotates when open"
            >
              <Chevron />
              <Chevron open />
            </Spec>

            <Spec
              id="a-selection"
              name="SelectionCircle"
              usage="multi-select toggle (block cards)"
              recipe="idle = ring · selected = filled + check"
            >
              <div className="rounded-xl bg-neutral-800 p-3">
                <SelectionCircle
                  selected={selected}
                  className="opacity-100"
                  onClick={() => setSelected((s) => !s)}
                />
              </div>
              <span className="text-xs text-neutral-500">
                click to toggle → {selected ? "selected" : "idle"}
              </span>
            </Spec>

            <Spec
              id="a-icon"
              name="Icons"
              usage="Flero icon library, recolored to currentColor"
            >
              <div className="grid w-full grid-cols-4 gap-4 sm:grid-cols-6 lg:grid-cols-9">
                {ICONS.map((ic) => (
                  <div
                    key={ic.label}
                    className="flex flex-col items-center gap-1.5 text-neutral-300"
                  >
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-xl border bg-neutral-900 ${
                        ic.flero ? "border-neutral-700" : "border-dashed border-neutral-800"
                      }`}
                    >
                      {ic.node}
                    </div>
                    <span className="text-[10px] text-neutral-500">{ic.label}</span>
                  </div>
                ))}
              </div>
            </Spec>

            <Spec
              id="a-status"
              name="Status text"
              usage="success / error inline feedback"
            >
              <span className="text-xs text-emerald-400">Saved.</span>
              <span className="text-xs text-red-400">Not authorized.</span>
            </Spec>
          </Section>

          {/* MOLECULES */}
          <Section
            id="molecules"
            title="Molecules"
            intro="Compositions of atoms. The Menu here is the exact primitive used by the sort, channel, and block-action menus."
          >
            <Spec
              id="m-menu"
              name="Menu"
              usage="MenuPanel + MenuItem (+ MenuLabel / MenuDivider)"
              recipe="one canonical dropdown for OrderDropdown, ChannelActions, BlockActions"
            >
              <div className="flex flex-col items-start gap-3">
                <button
                  type="button"
                  onClick={() => setMenuOpen((o) => !o)}
                  className="flex items-center gap-1.5 rounded-xl border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:bg-neutral-900"
                >
                  <span>Toggle menu</span>
                  <Chevron open={menuOpen} />
                </button>
                {menuOpen && (
                  <MenuPanel className="w-60">
                    <MenuLabel>Sort · radio indicator</MenuLabel>
                    <MenuItem
                      selected
                      leading={
                        <span className="h-1.5 w-1.5 rounded-full border border-neutral-200 bg-neutral-200" />
                      }
                      label="Newest first"
                    />
                    <MenuItem
                      leading={
                        <span className="h-1.5 w-1.5 rounded-full border border-neutral-600" />
                      }
                      label="Oldest first"
                    />
                    <MenuDivider />
                    <MenuItem leading={<IconStar />} label="With icon" />
                    <MenuItem
                      leading={<IconStar />}
                      label="With shortcut"
                      trailing={
                        <kbd className="rounded border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 font-mono text-[10px] text-neutral-400">
                          D
                        </kbd>
                      }
                    />
                    <MenuItem leading={<IconTrash />} label="Danger action" danger />
                    <MenuItem leading={<IconStar />} label="Disabled" disabled />
                  </MenuPanel>
                )}
              </div>
            </Spec>

            <Spec
              id="m-taglist"
              name="Tag list"
              usage="wrapped Pills below a card / in a picker"
              recipe='<div className="flex flex-wrap gap-1">…</div>'
            >
              <div className="flex flex-wrap gap-1">
                <Pill>Design</Pill>
                <Pill>AI</Pill>
                <Pill>Typography</Pill>
                <Pill>Motion</Pill>
              </div>
            </Spec>

            <Spec
              id="m-actionrow"
              name="Action row"
              usage="secondary buttons + optional Edit/Save (BlockDetail)"
            >
              <div className="flex gap-2">
                <Button variant="secondary">Connect →</Button>
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-xl border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-900"
                >
                  <span>Actions</span>
                  <Chevron />
                </button>
                <Button variant="secondary">Edit</Button>
              </div>
            </Spec>

            <Spec
              id="m-dialog"
              name="Dialog / ConfirmDialog"
              usage="branded popup · replaces window.confirm()"
              recipe='<ConfirmDialog open tone="danger" title="Delete?" … /> · shell: Dialog (portal + dialog-in)'
            >
              <Button variant="secondary" onClick={() => setDialogOpen(true)}>
                Open confirm dialog
              </Button>
              <span className="text-xs text-neutral-500">
                Enter confirms · Esc / backdrop cancels
              </span>
              <ConfirmDialog
                open={dialogOpen}
                tone="danger"
                title="Delete 1 block?"
                message="This can't be undone."
                confirmLabel="Delete"
                onConfirm={() => setDialogOpen(false)}
                onCancel={() => setDialogOpen(false)}
              />
            </Spec>
          </Section>

          {/* ORGANISMS */}
          <Section
            id="organisms"
            title="Organisms"
            intro="Page-level compositions. BlockCard and ChannelCard render live with mock data; the TopBar above this page is itself an organism."
          >
            <Spec
              id="o-blockcard"
              name="BlockCard"
              usage="grid cell · text + paper variants, selectable"
            >
              <div className="grid w-full max-w-2xl grid-cols-2 gap-4 sm:grid-cols-3">
                <BlockCard block={demoTextBlock} />
                <BlockCard block={demoPaperBlock} />
                <BlockCard
                  block={demoTextBlock}
                  selected
                  selectionActive
                  onToggleSelect={() => {}}
                />
              </div>
            </Spec>

            <Spec
              id="o-channelcard"
              name="ChannelCard"
              usage="channels view · title + thumb strip + ⋯ menu"
            >
              <div className="w-full max-w-md">
                <ChannelCard channel={demoChannel} />
              </div>
            </Spec>

            <Spec
              id="o-guestbook"
              name="Guestbook note"
              usage="paper surface · 4 styles · handwritten (Caveat) · warm tints"
              recipe=".paper-note + .paper-note--{grid|torn|tape} (lib/guestbook GUESTBOOK_STYLES) · tint via cardBg(color) · text: font-[family-name:var(--font-hand)] · card: aspect-[4/5]"
            >
              <div className="flex w-full flex-col gap-4">
                <div className="grid w-full max-w-2xl grid-cols-2 gap-4 sm:grid-cols-4">
                  {GUESTBOOK_STYLES.map((s, i) => (
                    <div
                      key={s.key}
                      style={{
                        backgroundColor: cardBg(
                          GUESTBOOK_COLORS[i % GUESTBOOK_COLORS.length].key
                        ),
                      }}
                      className={`paper-note ${s.className} relative flex aspect-[4/5] flex-col rounded-md p-3`}
                    >
                      <span className="self-end text-[10px] text-stone-500">
                        {s.label}
                      </span>
                      <p className="mt-1 flex-1 font-[family-name:var(--font-hand)] text-lg leading-snug text-[#37322a]">
                        Hello Tanja!
                      </p>
                      <p className="text-right font-[family-name:var(--font-hand)] text-sm font-medium text-stone-700">
                        - T
                      </p>
                    </div>
                  ))}
                </div>
                {/* Warm paper palette (whole-card tints). */}
                <div className="flex items-center gap-1.5">
                  {GUESTBOOK_COLORS.map((c) => (
                    <span
                      key={c.key}
                      title={c.key}
                      style={{ backgroundColor: c.paper }}
                      className="h-5 w-5 rounded-full border border-black/10"
                    />
                  ))}
                </div>
              </div>
            </Spec>

            <Spec
              id="o-other"
              name="Other organisms"
              usage="AdminForm · BlockDetail · ChannelPicker · SelectionBar"
            >
              <span className="text-xs text-neutral-500">
                Data-driven organisms (they fire server actions) are documented,
                not instantiated here.
              </span>
            </Spec>
          </Section>

          {/* HOW IT'S BUILT */}
          <Section
            id="build"
            title="How it's built"
            intro="A hybrid system: shared primitives are the source of truth; older screens migrate onto them piece by piece."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-neutral-800 bg-background p-5">
                <div className="mb-3 text-xs uppercase tracking-wide text-neutral-500">
                  Primitives · in components/ui
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ADOPTED.map((c) => (
                    <span
                      key={c}
                      className="rounded-full border border-neutral-700 px-2.5 py-1 text-xs text-neutral-200"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-neutral-800 bg-background p-5">
                <div className="mb-3 text-xs uppercase tracking-wide text-neutral-500">
                  Migrating · still inline
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {MIGRATING.map((c) => (
                    <span
                      key={c}
                      className="rounded-full border border-neutral-800 px-2.5 py-1 text-xs text-neutral-500"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Inline helpers + icon set used by the catalogue examples.
   --------------------------------------------------------------------------- */

function MotionDemo() {
  const [k, setK] = useState(0);
  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => setK((n) => n + 1)}
        className="rounded-xl border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-900"
      >
        Replay
      </button>
      <div className="flex gap-3 overflow-hidden">
        <div
          key={`p-${k}`}
          className="flex h-12 w-24 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-[10px] text-neutral-400"
          style={{ animation: "panel-in 0.4s ease-out" }}
        >
          panel-in
        </div>
        <div
          key={`d-${k}`}
          className="flex h-12 w-24 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-[10px] text-neutral-400"
          style={{ animation: "dialog-in 0.4s ease-out" }}
        >
          dialog-in
        </div>
      </div>
    </div>
  );
}

