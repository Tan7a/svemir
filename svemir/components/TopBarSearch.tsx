"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Live search box in the TopBar. Mirrors the debounced pattern in BlockPicker,
 * but instead of fetching itself it drives the URL `?q=` param - the homepage
 * reads it and renders matching results in the main view (see SearchRoute in
 * app/page.tsx). Uses router.replace so each keystroke doesn't pile up history.
 */
export default function TopBarSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get("q") ?? "");

  useEffect(() => {
    const q = value.trim();
    const current = (searchParams.get("q") ?? "").trim();
    if (q === current) return;
    const handle = setTimeout(() => {
      router.replace(q ? `/?q=${encodeURIComponent(q)}` : "/", {
        scroll: false,
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [value, router, searchParams]);

  return (
    <div className="hidden items-center text-sm text-neutral-500 lg:flex">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search svemir"
        className="w-56 bg-transparent text-neutral-300 placeholder:text-neutral-500 focus:outline-none"
      />
    </div>
  );
}
