const $ = (sel) => document.querySelector(sel);

async function load() {
  const out = await chrome.storage.local.get(["baseUrl", "token"]);
  $("#baseUrl").value = out.baseUrl ?? "";
  $("#token").value = out.token ?? "";
}

async function save() {
  const baseUrl = $("#baseUrl").value.trim().replace(/\/$/, "");
  const token = $("#token").value.trim();

  if (!baseUrl || !token) {
    $("#status").textContent = "Fill in both fields.";
    $("#status").className = "muted small error";
    return;
  }

  await chrome.storage.local.set({ baseUrl, token });

  $("#status").textContent = "Testing connection…";
  $("#status").className = "muted small";

  try {
    const res = await fetch(baseUrl + "/api/channels", {
      headers: { Authorization: "Bearer " + token },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      $("#status").textContent =
        "Saved, but request failed: " + (data.error ?? "HTTP " + res.status);
      $("#status").className = "muted small error";
      return;
    }
    $("#status").textContent = "Saved and verified ✓";
    $("#status").className = "muted small success";
  } catch (e) {
    $("#status").textContent =
      "Saved, but cannot reach the archive: " + e.message;
    $("#status").className = "muted small error";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  load();
  $("#save").addEventListener("click", save);
});
