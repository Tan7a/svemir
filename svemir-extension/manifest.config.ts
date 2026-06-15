import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "svemir",
  version: "0.1.0",
  description: "Save the web to your svemir.",
  action: {
    default_popup: "src/popup/index.html",
  },
  options_page: "src/options/index.html",
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  permissions: ["storage", "contextMenus", "activeTab", "scripting", "debugger"],
  host_permissions: ["https://svemir.space/*", "http://localhost:3000/*"],
});
