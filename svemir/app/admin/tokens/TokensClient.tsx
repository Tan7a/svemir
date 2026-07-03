"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createToken, revokeToken } from "./actions";

export type TokenRow = {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
};

type Props = {
  initialTokens: TokenRow[];
};

function relativeOrNever(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const day = Math.floor(diff / 86_400_000);
  if (day < 1) return "today";
  if (day === 1) return "yesterday";
  if (day < 30) return `${day} days ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  return `${Math.floor(mo / 12)} year${Math.floor(mo / 12) === 1 ? "" : "s"} ago`;
}

export default function TokensClient({ initialTokens }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCreate() {
    setError(null);
    setCopied(false);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    const result = await createToken(name);
    setBusy(false);
    if (result.success) {
      setFresh({ name: name.trim(), token: result.token });
      setName("");
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  async function handleRevoke(id: string, label: string) {
    if (!confirm(`Revoke token "${label}"? This cannot be undone.`)) return;
    const result = await revokeToken(id);
    if (!result.success) {
      setError(result.error);
      return;
    }
    if (fresh && initialTokens.find((t) => t.id === id)) {
      setFresh(null);
    }
    router.refresh();
  }

  async function copyToken() {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore - user can select manually
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="text-sm font-medium text-neutral-200">Mint a new token</h2>
        <p className="mt-1 text-xs text-neutral-500">
          For the Chrome extension or curl-based scripts. The plaintext is shown
          once and never stored - copy it immediately.
        </p>
        <div className="mt-4 flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Chrome extension"
            className="flex-1 rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-500"
            disabled={busy}
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy || !name.trim()}
            className="rounded-xl bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-60"
          >
            {busy ? "Minting…" : "Create"}
          </button>
        </div>
        {error && (
          <p className="mt-3 text-sm text-red-400">{error}</p>
        )}
      </section>

      {fresh && (
        <section className="rounded-xl border border-emerald-900 bg-emerald-950/40 p-5">
          <h2 className="text-sm font-medium text-emerald-300">
            Token for &ldquo;{fresh.name}&rdquo; - copy it now
          </h2>
          <p className="mt-1 text-xs text-emerald-400/80">
            This is the only time you&apos;ll see the plaintext. After you
            navigate away or refresh, only the hash remains.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 break-all rounded-xl border border-emerald-900 bg-emerald-950 px-3 py-2 font-mono text-xs text-emerald-200">
              {fresh.token}
            </code>
            <button
              type="button"
              onClick={copyToken}
              className="rounded-xl border border-emerald-700 bg-emerald-900 px-3 py-2 text-xs font-medium text-emerald-100 hover:bg-emerald-800"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setFresh(null)}
            className="mt-3 text-xs text-emerald-400/70 hover:text-emerald-200"
          >
            I&apos;ve saved it - hide
          </button>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium text-neutral-300">
          Active tokens ({initialTokens.length})
        </h2>
        {initialTokens.length === 0 ? (
          <p className="rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-center text-sm text-neutral-500">
            No tokens yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
            <table className="w-full text-sm">
              <thead className="bg-neutral-800 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-2 text-left">Name</th>
                  <th className="px-4 py-2 text-left">Created</th>
                  <th className="px-4 py-2 text-left">Last used</th>
                  <th className="w-24 px-4 py-2 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {initialTokens.map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-2 text-neutral-200">{t.name}</td>
                    <td className="px-4 py-2 text-neutral-400">
                      {relativeOrNever(t.created_at)}
                    </td>
                    <td className="px-4 py-2 text-neutral-400">
                      {relativeOrNever(t.last_used_at)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleRevoke(t.id, t.name)}
                        className="rounded-xl border border-red-900 bg-transparent px-2.5 py-1 text-xs text-red-400 hover:bg-red-950"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
