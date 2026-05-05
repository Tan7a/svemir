"use client";

import Link from "next/link";
import type { ItemWithChannels } from "@/lib/types";
import { colorForTag } from "@/lib/constants";

type Props = {
  items: ItemWithChannels[];
  onOpen: (id: string) => void;
};

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export default function BlockTable({ items, onOpen }: Props) {
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500">
        No items.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-xs text-zinc-500">
          <tr>
            <th className="w-14 p-3"></th>
            <th className="p-3 text-left">Title</th>
            <th className="p-3 text-left w-64">Channels</th>
            <th className="p-3 text-left w-40">Source</th>
            <th className="p-3 text-right w-28">Added</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {items.map((item) => (
            <tr
              key={item.id}
              onClick={() => onOpen(item.id)}
              className="cursor-pointer hover:bg-zinc-50"
            >
              <td className="p-2">
                <div className="h-10 w-12 overflow-hidden rounded bg-zinc-100">
                  {item.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.image_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
              </td>
              <td className="p-3">
                <p className="line-clamp-1 font-medium text-zinc-900">
                  {item.title}
                </p>
                {item.description && (
                  <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500">
                    {item.description}
                  </p>
                )}
              </td>
              <td className="p-3" onClick={(e) => e.stopPropagation()}>
                <div className="flex flex-wrap gap-1">
                  {item.channels.slice(0, 4).map((ch) => {
                    const c = colorForTag(ch.id);
                    return (
                      <Link
                        key={ch.id}
                        href={`/channel/${ch.slug}`}
                        className={`rounded-full px-2 py-0.5 text-[10px] hover:opacity-80 ${c.bg} ${c.text}`}
                      >
                        {ch.name}
                      </Link>
                    );
                  })}
                  {item.channels.length > 4 && (
                    <span className="text-[10px] text-zinc-400">
                      +{item.channels.length - 4}
                    </span>
                  )}
                </div>
              </td>
              <td className="p-3 text-xs text-zinc-500">
                {item.source_name ?? "—"}
              </td>
              <td className="p-3 text-right text-xs text-zinc-500">
                {formatDate(item.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
