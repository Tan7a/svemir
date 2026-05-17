import { setPendingAsset } from "../lib/storage";
import type { ExtractedAsset } from "../lib/types";

const CONTEXT_MENU_ID = "svemir-save-image";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: "Save image to svemir",
    contexts: ["image"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  if (!tab?.id) return;
  if (!info.srcUrl) return;

  let hostname = "";
  try {
    hostname = new URL(info.pageUrl ?? info.srcUrl).hostname;
  } catch {
    /* ignore */
  }

  const asset: ExtractedAsset = {
    kind: "image",
    url: info.pageUrl ?? info.srcUrl,
    image_url: info.srcUrl,
    title: tab.title ?? "",
    description: "",
    source_name: hostname,
  };

  await setPendingAsset(tab.id, asset);

  // chrome.action.openPopup requires Chrome 127+ and runs only inside a
  // user-gesture frame (which we're in — the context-menu click). On
  // older Chrome this throws; fall back to a notification.
  try {
    await chrome.action.openPopup();
  } catch (e) {
    // No notifications permission and openPopup unavailable: log and let
    // the user click the toolbar icon — pending asset is in session storage.
    console.warn("svemir: openPopup unavailable, asset stashed for tab", tab.id, e);
  }
});
