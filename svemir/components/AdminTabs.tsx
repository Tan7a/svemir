import Link from "next/link";

type Props = {
  active?: "add" | "import" | "manage" | "tokens";
};

const tabs = [
  { id: "add", label: "Add one", href: "/admin" },
  { id: "import", label: "Bulk import", href: "/admin/import" },
  { id: "manage", label: "Manage", href: "/admin/manage" },
  { id: "tokens", label: "Tokens", href: "/admin/tokens" },
] as const;

export default function AdminTabs({ active }: Props) {
  return (
    <div className="border-b border-neutral-900 bg-[#0a0a0a]">
      <div className="mx-auto flex max-w-6xl items-center gap-1 px-6 py-3">
        {tabs.map((t) => {
          const isActive = active === t.id;
          return (
            <Link
              key={t.id}
              href={t.href}
              className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                isActive
                  ? "bg-neutral-100 text-neutral-900"
                  : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
