import { setPendingAsset } from "../lib/storage";
import type { ExtractedAsset } from "../lib/types";

const MENU_SAVE_IMAGE = "svemir-save-image";
const MENU_SAVE_SELECTION = "svemir-save-selection";

// Context menus persist in the browser profile and only (re)register here, on
// install/update - a rebuild alone won't surface a new item; reload the
// extension in chrome://extensions.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_SAVE_IMAGE,
    title: "Save image to svemir",
    contexts: ["image"],
  });
  chrome.contextMenus.create({
    id: MENU_SAVE_SELECTION,
    title: "Save selection to svemir",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  let hostname = "";
  try {
    hostname = new URL(info.pageUrl ?? info.srcUrl ?? "").hostname;
  } catch {
    /* ignore */
  }

  let asset: ExtractedAsset | null = null;
  if (info.menuItemId === MENU_SAVE_IMAGE && info.srcUrl) {
    asset = {
      kind: "image",
      url: info.pageUrl ?? info.srcUrl,
      image_url: info.srcUrl,
      title: tab.title ?? "",
      description: "",
      source_name: hostname,
    };
  } else if (info.menuItemId === MENU_SAVE_SELECTION && info.selectionText) {
    // A text block: the selection becomes the description (what the API
    // requires for kind "text") and body_text (what concept extraction reads).
    asset = {
      kind: "text",
      url: info.pageUrl ?? "",
      image_url: "",
      title: tab.title ?? "",
      description: info.selectionText,
      source_name: hostname,
      body_text: info.selectionText,
    };
  }
  if (!asset) return;

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
