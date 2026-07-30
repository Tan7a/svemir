import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isAuthed } from "@/lib/access-server";
import TopBar from "@/components/TopBar";
import { IconLock } from "@/components/ui/icons";

/**
 * Owner's channel index: every channel including private ones (which the
 * public channels view can't show), so private channels stay reachable.
 * Private rows link to the admin mirror page; public rows to the public page.
 */
export const dynamic = "force-dynamic";

export default async function AdminChannelsPage() {
  if (!(await isAuthed())) notFound();
  if (!supabaseAdmin) {
    return (
      <main className="p-8 text-sm text-neutral-400">
        Supabase admin is not configured.
      </main>
    );
  }

  const { data } = await supabaseAdmin
    .from("channels")
    .select("id, slug, title, is_private, meta:connections(count)")
    .order("title");

  const channels = (data ?? []) as {
    id: string;
    slug: string;
    title: string;
    is_private: boolean | null;
    meta: { count: number }[] | null;
  }[];

  return (
    <>
      <TopBar />
      <div className="px-5 pt-8 pb-6">
        <h1 className="font-[family-name:var(--font-display)] text-3xl tracking-wider text-neutral-100">
          all channels
        </h1>
        <p className="mt-3 max-w-prose text-xs leading-relaxed text-neutral-500">
          Owner view: includes private channels, which never appear on the
          public site.
        </p>
      </div>
      <main className="px-5 pb-16">
        <ul className="flex flex-col divide-y divide-neutral-900">
          {channels.map((c) => (
            <li key={c.id}>
              <Link
                href={
                  c.is_private ? `/admin/channel/${c.slug}` : `/channel/${c.slug}`
                }
                className="flex items-center gap-3 py-3 text-sm text-neutral-300 hover:text-neutral-100"
              >
                <span>{c.title}</span>
                {c.is_private && (
                  <span className="flex items-center gap-1 rounded-full border border-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">
                    <IconLock size={12} /> Private
                  </span>
                )}
                <span className="ml-auto text-xs text-neutral-500">
                  {c.meta?.[0]?.count ?? 0} blocks
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
