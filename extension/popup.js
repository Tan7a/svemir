const RECENT_KEY = "recent_channel_ids";
const RECENT_MAX = 6;

const state = {
  channels: [],
  recentIds: [],
  selectedIds: new Set(),
  baseUrl: "",
  token: "",
  tabUrl: "",
  tabTitle: "",
};

const $ = (sel) => document.querySelector(sel);

function setStatus(msg, kind) {
  const el = $("#status");
  el.textContent = msg ?? "";
  el.className = "muted small" + (kind ? " " + kind : "");
}

async function loadConfig() {
  const out = await chrome.storage.local.get(["baseUrl", "token", RECENT_KEY]);
  state.baseUrl = (out.baseUrl ?? "").replace(/\/$/, "");
  state.token = out.token ?? "";
  state.recentIds = Array.isArray(out[RECENT_KEY]) ? out[RECENT_KEY] : [];
}

async function saveRecent(ids) {
  const next = [...ids, ...state.recentIds.filter((id) => !ids.includes(id))]
    .slice(0, RECENT_MAX);
  state.recentIds = next;
  await chrome.storage.local.set({ [RECENT_KEY]: next });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return null;
  return { url: tab.url ?? "", title: tab.title ?? "" };
}

async function api(path, opts = {}) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: "Bearer " + state.token,
    ...(opts.headers ?? {}),
  };
  const res = await fetch(state.baseUrl + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

function renderChannels() {
  const search = $("#search").value.trim();
  const lc = search.toLowerCase();

  const filtered = lc
    ? state.channels.filter((c) => c.name.toLowerCase().includes(lc))
    : state.channels;

  const recentSection = $("#recent-section");
  const recentList = $("#recent-list");
  const allList = $("#all-list");
  const emptyMsg = $("#empty-msg");

  recentList.innerHTML = "";
  allList.innerHTML = "";

  if (!search && state.recentIds.length > 0) {
    const map = new Map(state.channels.map((c) => [c.id, c]));
    const recent = state.recentIds.map((id) => map.get(id)).filter(Boolean);
    if (recent.length > 0) {
      recentSection.hidden = false;
      recent.forEach((c) => recentList.appendChild(channelRow(c)));
    } else {
      recentSection.hidden = true;
    }
  } else {
    recentSection.hidden = true;
  }

  if (filtered.length === 0 && !search) {
    emptyMsg.hidden = false;
  } else {
    emptyMsg.hidden = true;
    filtered.forEach((c) => allList.appendChild(channelRow(c)));
  }

  // Create row
  const exact = state.channels.find(
    (c) => c.name.toLowerCase() === lc
  );
  const createRow = $("#create-row");
  if (search && !exact) {
    createRow.hidden = false;
    $("#create-name").textContent = search;
  } else {
    createRow.hidden = true;
  }

  updateSaveBtn();
}

function channelRow(channel) {
  const button = document.createElement("button");
  button.className =
    "channel-row" + (state.selectedIds.has(channel.id) ? " selected" : "");
  button.innerHTML = `
    <span class="check">✓</span>
    <span class="name"></span>
    <span class="count"></span>
  `;
  button.querySelector(".name").textContent = channel.name;
  if (typeof channel.itemCount === "number") {
    button.querySelector(".count").textContent = channel.itemCount;
  }
  button.addEventListener("click", () => {
    if (state.selectedIds.has(channel.id)) state.selectedIds.delete(channel.id);
    else state.selectedIds.add(channel.id);
    renderChannels();
  });
  return button;
}

function updateSaveBtn() {
  const n = state.selectedIds.size;
  const btn = $("#save-btn");
  btn.textContent = `Connect to ${n} channel${n === 1 ? "" : "s"}`;
  btn.disabled = n === 0;
}

async function fetchChannels() {
  try {
    const { channels } = await api("/api/channels");
    state.channels = channels;
    renderChannels();
  } catch (e) {
    setStatus("Failed to load channels: " + e.message, "error");
  }
}

async function createChannel() {
  const name = $("#search").value.trim();
  if (!name) return;
  try {
    const { channel } = await api("/api/channels", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    state.channels.push({ ...channel, itemCount: 0 });
    state.selectedIds.add(channel.id);
    $("#search").value = "";
    renderChannels();
  } catch (e) {
    setStatus("Could not create channel: " + e.message, "error");
  }
}

async function save() {
  const channelIds = [...state.selectedIds];
  if (channelIds.length === 0) return;
  setStatus("Saving…");
  $("#save-btn").disabled = true;

  try {
    await api("/api/items", {
      method: "POST",
      body: JSON.stringify({
        url: state.tabUrl,
        title: $("#title-input").value || state.tabTitle,
        notes: $("#notes-input").value || "",
        channelIds,
        autoScrape: true,
      }),
    });
    await saveRecent(channelIds);
    setStatus("Saved.", "success");
    setTimeout(() => window.close(), 700);
  } catch (e) {
    setStatus("Save failed: " + e.message, "error");
    $("#save-btn").disabled = false;
  }
}

async function init() {
  await loadConfig();

  if (!state.baseUrl || !state.token) {
    $("#needs-config").hidden = false;
    $("#open-options").addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });
    return;
  }

  $("#main").hidden = false;

  const tab = await getActiveTab();
  if (tab) {
    state.tabUrl = tab.url;
    state.tabTitle = tab.title;
    $("#page-title").textContent = tab.title || tab.url;
    $("#page-url").textContent = tab.url;
    $("#title-input").value = tab.title;
  }

  $("#search").addEventListener("input", renderChannels);
  $("#search").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !$("#create-row").hidden) {
      e.preventDefault();
      createChannel();
    }
  });
  $("#create-btn").addEventListener("click", createChannel);
  $("#save-btn").addEventListener("click", save);

  await fetchChannels();
}

init();
