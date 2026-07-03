"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MenuPanel, MenuItem } from "./ui/Menu";
import { IconMenu, IconClose } from "./ui/icons";

/**
 * Mobile navigation. Below 900px the horizontal ViewNav is hidden, so this
 * hamburger (top-right of the TopBar) is the only way to reach the other views.
 * It mirrors ViewNav's destinations + active-state logic but renders them as a
 * dropdown of full-width rows. Everything navigates via router.push so a single
 * tap both moves and closes the menu. Hidden at >=900px where ViewNav takes over.
 */

type Dest = { label: string; href: string; active: boolean };

export default function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const onHome = pathname === "/";
  const view = searchParams.get("view") === "channels" ? "channels" : "blocks";

  const destinations: Dest[] = [
    { label: "Blocks", href: "/?view=blocks", active: onHome && view === "blocks" },
    {
      label: "Channels",
      href: "/?view=channels",
      active: onHome && view === "channels",
    },
    { label: "Graph", href: "/graph", active: pathname === "/graph" },
    { label: "Research", href: "/facets", active: pathname === "/facets" },
    {
      label: "Design",
      href: "/design-system",
      active: pathname === "/design-system",
    },
  ];

  function go(href: string) {
    router.push(href, { scroll: false });
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative md:hidden">
      <button
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center rounded-xl px-2 py-1 text-neutral-300 hover:bg-neutral-900 hover:text-neutral-100"
      >
        {open ? <IconClose size={20} /> : <IconMenu size={20} />}
      </button>
      {open && (
        <MenuPanel className="absolute right-0 z-40 mt-1 min-w-[11rem]">
          {destinations.map((d) => (
            <MenuItem
              key={d.href}
              selected={d.active}
              onClick={() => go(d.href)}
              label={d.label}
            />
          ))}
        </MenuPanel>
      )}
    </div>
  );
}
