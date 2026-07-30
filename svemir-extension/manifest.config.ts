import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "svemir",
  version: "0.1.6",
  description: "Save the web to your svemir.",
  // Also shown beside our context-menu items; without these Chrome falls back
  // to the generic puzzle piece. Files live in public/icons (copied to dist).
  icons: {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png",
  },
  action: {
    default_popup: "src/popup/index.html",
    default_icon: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
  },
  options_page: "src/options/index.html",
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  permissions: ["storage", "contextMenus", "activeTab", "scripting"],
  host_permissions: ["https://svemir.space/*", "http://localhost:3000/*"],
});
