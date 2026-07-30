import { clearPendingAsset, setPendingAsset } from "../lib/storage";
import type { ExtractedAsset } from "../lib/types";

const MENU_SAVE_IMAGE = "svemir-save-image";
const MENU_SAVE_SELECTION = "svemir-save-selection";

// Matches the extractor's body cap (src/extract/extract.ts) so a "select all"
// on a huge page can't balloon session storage or the API payload.
const MAX_SELECTION_CHARS = 50_000;

// Callback-form wrappers so chrome.runtime.lastError is always consumed
// (unchecked it surfaces as console noise and hides real failures) and so the
// registration chain is awaitable on Chromium forks with patchy promise
// support in contextMenus.
function removeAllMenus(): Promise<void> {
  return new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => {
      const err = chrome.runtime.lastError;
      if (err) console.warn("svemir: contextMenus.removeAll:", err.message);
      resolve();
    });
  });
}

function createMenu(
  props: chrome.contextMenus.CreateProperties
): Promise<void> {
  return new Promise((resolve) => {
    chrome.contextMenus.create(props, () => {
      const err = chrome.runtime.lastError;
      if (err) console.warn("svemir: contextMenus.create:", err.message);
      resolve();
    });
  });
}

// Register from scratch (removeAll first, so re-registration never collides
// with leftovers) on BOTH install/update and browser startup. Some Chromium
// forks don't reliably fire onInstalled for unpacked reloads, which left the
// menu missing; onStartup covers the next launch regardless. The two events
// can also BOTH fire in one session (e.g. a Chrome update), so registrations
// share one in-flight promise: without it, interleaved removeAll/create pairs
// race into "duplicate id" errors. Awaiting the full chain also keeps the MV3
// worker alive until the menus actually exist.
let menuRegistration: Promise<void> | null = null;

function registerMenus(): Promise<void> {
  if (!menuRegistration) {
    menuRegistration = (async () => {
      try {
        await removeAllMenus();
        // One label for both contexts, Are.na style: which one fires is
        // decided by what was right-clicked (an image vs a text selection).
        await createMenu({
          id: MENU_SAVE_IMAGE,
          title: "Move to Svemir",
          contexts: ["image"],
        });
        await createMenu({
          id: MENU_SAVE_SELECTION,
          title: "Move to Svemir",
          contexts: ["selection"],
        });
      } finally {
        menuRegistration = null;
      }
    })();
  }
  return menuRegistration;
}
chrome.runtime.onInstalled.addListener(registerMenus);
chrome.runtime.onStartup.addListener(registerMenus);

/**
 * Chromium caps info.selectionText at ~1KB, cut mid-word. The context-menu
 * click grants activeTab, so read the real selection from the page instead;
 * pages we can't script (chrome://, the Web Store, PDF viewer) throw, and the
 * caller falls back to the capped text.
 */
async function readFullSelection(tabId: number): Promise<string | null> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.getSelection()?.toString() ?? "",
    });
    const text = results?.[0]?.result;
    if (typeof text !== "string" || !text.trim()) return null;
    if (text.length > MAX_SELECTION_CHARS) {
      return text.slice(0, MAX_SELECTION_CHARS) + "\n…(truncated)";
    }
    return text;
  } catch {
    return null;
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // Bail before any work for menu items that aren't ours (none today, but
  // this trap has bitten once already when the guard was dropped).
  if (
    info.menuItemId !== MENU_SAVE_IMAGE &&
    info.menuItemId !== MENU_SAVE_SELECTION
  ) {
    return;
  }
  if (!tab?.id) return;
  const tabId = tab.id;

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
    const selection = (await readFullSelection(tabId)) ?? info.selectionText;
    // The API requires a title for text blocks (400 otherwise) and some pages
    // have an empty tab.title; fall back to the hostname, then the selection's
    // opening words, so the save can't fail after channels were picked.
    const title =
      (tab.title ?? "").trim() ||
      hostname ||
      selection.split(/\s+/).slice(0, 8).join(" ");
    // A text block: the selection becomes the description (what the API
    // requires for kind "text") and body_text (what concept extraction reads).
    asset = {
      kind: "text",
      url: info.pageUrl ?? "",
      image_url: "",
      title,
      description: selection,
      source_name: hostname,
      body_text: selection,
    };
  }
  if (!asset) return;

  try {
    // stashedAt lets the popup ignore stale stashes: if the popup never opens
    // (or the user dismisses it), the stash would otherwise hijack the next
    // toolbar click on this tab for the rest of the browser session.
    await setPendingAsset(tabId, { ...asset, stashedAt: Date.now() });
  } catch (e) {
    console.warn("svemir: failed to stash asset for tab", tabId, e);
    return;
  }

  // chrome.action.openPopup requires Chrome 127+ and a user-gesture frame;
  // the awaits above may have dropped gesture association, and forks like Dia
  // reject it outright - which made "Move to Svemir" look like it did
  // nothing. Fall back to the same popup page as a small window pinned to
  // the top-right. windows.create has no gesture requirement, and the target
  // tab rides in the URL because a detached window's own "active tab" is the
  // popup page itself, not the page being saved.
  try {
    await chrome.action.openPopup();
  } catch (e) {
    try {
      const win = await chrome.windows.get(tab.windowId);
      const width = 390;
      await chrome.windows.create({
        url: chrome.runtime.getURL(`src/popup/index.html?tab=${tabId}`),
        type: "popup",
        width,
        height: 640,
        left: Math.max((win.left ?? 0) + (win.width ?? width) - width - 16, 0),
        top: (win.top ?? 0) + 88,
      });
    } catch (e2) {
      console.warn("svemir: could not open any popup for tab", tabId, e, e2);
    }
  }
});

// A closed tab's stash can never be claimed; drop it instead of letting it
// sit in session storage until the browser exits.
chrome.tabs.onRemoved.addListener((tabId) => {
  void clearPendingAsset(tabId);
});
