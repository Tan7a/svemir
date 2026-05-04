"use client";

type Props = {
  value: string;
  onChange: (value: string) => void;
};

export default function SearchBar({ value, onChange }: Props) {
  return (
    <div className="w-full max-w-md">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Type here to find what you're looking for..."
        className="w-full rounded-full border border-white/50 bg-white/30 px-5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-500 backdrop-blur-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
      />
    </div>
  );
}
