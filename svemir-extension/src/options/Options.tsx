import { useEffect, useState } from "react";
import { listChannels } from "../lib/api";
import { getSettings, saveSettings } from "../lib/storage";
import { DEFAULT_SETTINGS, type Settings } from "../lib/types";

type Test =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; count: number }
  | { kind: "fail"; message: string };

export default function Options() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<Test>({ kind: "idle" });

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  async function handleSave() {
    await saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function handleTest() {
    setTest({ kind: "running" });
    try {
      const channels = await listChannels(settings);
      setTest({ kind: "ok", count: channels.length });
    } catch (e) {
      setTest({
        kind: "fail",
        message: e instanceof Error ? e.message : "Connection failed",
      });
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-medium text-neutral-100">
          ✻ svemir extension settings
        </h1>
        <p className="text-sm text-neutral-500">
          Connect the extension to your svemir instance.
        </p>
      </header>

      <div className="space-y-4 rounded-md border border-neutral-800 bg-neutral-950 p-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-300">
            Base URL
          </label>
          <input
            type="url"
            value={settings.baseUrl}
            onChange={(e) =>
              setSettings({ ...settings, baseUrl: e.target.value.trim() })
            }
            placeholder="https://svemir.space"
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-500"
          />
          <p className="mt-1 text-xs text-neutral-500">
            Default: https://svemir.space — change to{" "}
            <code>http://localhost:3000</code> for local dev.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-300">
            API Token
          </label>
          <input
            type="password"
            value={settings.token}
            onChange={(e) =>
              setSettings({ ...settings, token: e.target.value.trim() })
            }
            placeholder="Paste a token from /admin/tokens"
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-500"
          />
          <p className="mt-1 text-xs text-neutral-500">
            Mint a token at <code>{settings.baseUrl}/admin/tokens</code>. Stored
            in <code>chrome.storage.local</code> — never synced via Google.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white"
          >
            Save
          </button>
          <button
            type="button"
            onClick={handleTest}
            disabled={!settings.token || test.kind === "running"}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
          >
            {test.kind === "running" ? "Testing…" : "Test connection"}
          </button>
          {saved && <span className="text-sm text-emerald-400">Saved.</span>}
        </div>

        {test.kind === "ok" && (
          <p className="text-sm text-emerald-400">
            ✓ Connected — {test.count} channels visible.
          </p>
        )}
        {test.kind === "fail" && (
          <p className="text-sm text-red-400">✗ {test.message}</p>
        )}
      </div>
    </div>
  );
}
