import { DEFAULT_SETTINGS, type Settings, type ExtractedAsset } from "./types";

const SETTINGS_KEY = "svemir.settings";

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const raw = stored[SETTINGS_KEY];
  if (!raw) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...raw };
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: s });
}

export function pendingAssetKey(tabId: number): string {
  return `asset-${tabId}`;
}

export async function getPendingAsset(
  tabId: number
): Promise<ExtractedAsset | null> {
  const key = pendingAssetKey(tabId);
  const stored = await chrome.storage.session.get(key);
  return (stored[key] as ExtractedAsset | undefined) ?? null;
}

export async function clearPendingAsset(tabId: number): Promise<void> {
  await chrome.storage.session.remove(pendingAssetKey(tabId));
}

export async function setPendingAsset(
  tabId: number,
  asset: ExtractedAsset
): Promise<void> {
  await chrome.storage.session.set({ [pendingAssetKey(tabId)]: asset });
}
