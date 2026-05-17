import Link from "next/link";

type Props = {
  active?: "add" | "import" | "manage";
};

const tabs = [
  { id: "add", label: "Add one", href: "/admin" },
  { id: "import", label: "Bulk import", href: "/admin/import" },
  { id: "manage", label: "Manage", href: "/admin/manage" },
] as const;

export default function AdminNav({ active }: Props) {
  return (
    <header className="border-b border-zinc-200 bg-[#FBF8F4]">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4">
        <Link href="/archive" className="text-sm text-zinc-500 hover:text-zinc-900">
          ← Archive
        </Link>
        <nav className="flex gap-1">
          {tabs.map((t) => {
            const isActive = active === t.id;
            return (
              <Link
                key={t.id}
                href={t.href}
                className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                  isActive
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-700 hover:bg-zinc-100"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
