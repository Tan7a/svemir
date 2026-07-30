import { setPendingAsset } from "../lib/storage";
import type { ExtractedAsset } from "../lib/types";

const MENU_SAVE_IMAGE = "svemir-save-image";
const MENU_SAVE_SELECTION = "svemir-save-selection";

// Register from scratch (removeAll first, so re-registration never collides
// with leftovers) on BOTH install/update and browser startup. Some Chromium
// forks don't reliably fire onInstalled for unpacked reloads, which left the
// menu missing; onStartup covers the next launch regardless.
function registerMenus() {
  chrome.contextMenus.removeAll(() => {
    // One label for both contexts, Are.na style: which one fires is decided
    // by what was right-clicked (an image vs a text selection).
    chrome.contextMenus.create({
      id: MENU_SAVE_IMAGE,
      title: "Move to Svemir",
      contexts: ["image"],
    });
    chrome.contextMenus.create({
      id: MENU_SAVE_SELECTION,
      title: "Move to Svemir",
      contexts: ["selection"],
    });
  });
}
chrome.runtime.onInstalled.addListener(registerMenus);
chrome.runtime.onStartup.addListener(registerMenus);

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
