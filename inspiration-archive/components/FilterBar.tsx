"use client";

import { CATEGORIES, CATEGORY_PILL_CLASSES } from "@/lib/constants";

type Props = {
  selected: string;
  onSelect: (value: string) => void;
};

export default function FilterBar({ selected, onSelect }: Props) {
  return (
    <>
      <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-white/50 bg-white/30 backdrop-blur-xl px-2 py-2 shadow-sm">
        <Pill
          label="All"
          active={selected === "All"}
          onClick={() => onSelect("All")}
          activeClass="bg-black text-white"
          inactiveClass="bg-white/60 text-zinc-700 hover:bg-white"
        />
        {CATEGORIES.map((cat) => {
          const active = selected === cat;
          return (
            <Pill
              key={cat}
              label={cat}
              active={active}
              onClick={() => onSelect(cat)}
              activeClass="bg-black text-white"
              inactiveClass={CATEGORY_PILL_CLASSES[cat]}
            />
          );
        })}
      </div>
      <button
        type="button"
        className="sm:hidden rounded-full border border-white/50 bg-white/30 backdrop-blur-xl px-5 py-2.5 text-sm font-medium text-zinc-900 shadow-sm"
        onClick={() => onSelect(selected === "All" ? "All" : "All")}
      >
        Filters
      </button>
    </>
  );
}

function Pill({
  label,
  active,
  onClick,
  activeClass,
  inactiveClass,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  activeClass: string;
  inactiveClass: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
        active ? activeClass : inactiveClass
      }`}
    >
      {label}
    </button>
  );
}
