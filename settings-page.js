// Settings Page - Shared state from localStorage (minimal interface with main app)
const settingsState = {
  blacklistSet: new Set(),
  channels: [],
};

const settingsEls = {
  playlistUrl: document.getElementById("playlistUrl"),
  loadBtn: document.getElementById("loadBtn"),
  status: document.getElementById("status"),
  exportSettingsBtn: document.getElementById("exportSettingsBtn"),
  importSettingsBtn: document.getElementById("importSettingsBtn"),
  importSettingsInput: document.getElementById("importSettingsInput"),
  ccPreferenceInput: document.getElementById("ccPreferenceInput"),
  addCcPreferenceBtn: document.getElementById("addCcPreferenceBtn"),
  ccPreferencesList: document.getElementById("ccPreferencesList"),
  blacklistCount: document.getElementById("blacklistCount"),
  clearBlacklistBtn: document.getElementById("clearBlacklistBtn"),
  hiddenChannelsList: document.getElementById("hiddenChannelsList"),
  recordingsInProgressList: document.getElementById("recordingsInProgressList"),
  recordingsCompletedList: document.getElementById("recordingsCompletedList"),
};

function setStatus(message, isError = false) {
  if (settingsEls.status) {
    settingsEls.status.textContent = message;
    settingsEls.status.className = isError ? "status error" : "status";
    setTimeout(() => {
      if (settingsEls.status) {
        settingsEls.status.textContent = "Ready.";
        settingsEls.status.className = "status";
      }
    }, 5000);
  }
}

function init() {
  // Add event listeners only if elements exist
  if (settingsEls.loadBtn) {
    settingsEls.loadBtn.addEventListener("click", () => void loadPlaylistForSettings());
  }
  if (settingsEls.exportSettingsBtn) {
    settingsEls.exportSettingsBtn.addEventListener("click", exportSettings);
  }
  if (settingsEls.importSettingsBtn) {
    settingsEls.importSettingsBtn.addEventListener("click", () => {
      if (settingsEls.importSettingsInput) {
        settingsEls.importSettingsInput.click();
      }
    });
  }
  if (settingsEls.importSettingsInput) {
    settingsEls.importSettingsInput.addEventListener("change", importSettings);
  }
  if (settingsEls.addCcPreferenceBtn) {
    settingsEls.addCcPreferenceBtn.addEventListener("click", addCcPreferenceForSettings);
  }
  if (settingsEls.ccPreferenceInput) {
    settingsEls.ccPreferenceInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        void addCcPreferenceForSettings();
      }
    });
  }
  if (settingsEls.clearBlacklistBtn) {
    settingsEls.clearBlacklistBtn.addEventListener("click", () => void clearBlacklistForSettings());
  }
  if (settingsEls.ccPreferencesList) {
    settingsEls.ccPreferencesList.addEventListener("click", (e) => void onCcPreferenceActionClick(e));
  }
  if (settingsEls.hiddenChannelsList) {
    settingsEls.hiddenChannelsList.addEventListener("click", (e) => void onHiddenChannelActionClick(e));
  }
  if (settingsEls.recordingsInProgressList) {
    settingsEls.recordingsInProgressList.addEventListener("click", (e) => void onRecordingActionClick(e));
  }
  if (settingsEls.recordingsCompletedList) {
    settingsEls.recordingsCompletedList.addEventListener("click", (e) => void onRecordingActionClick(e));
  }

  // Restore collapsed states on load
  document.querySelectorAll(".settings-card[data-section]").forEach((card) => {
    const section = card.dataset.section;
    if (localStorage.getItem(`collapsed-${section}`) === "true") {
      const content = card.querySelector(".card-content");
      if (content) {
        content.classList.add("collapsed");
      }
    }
  });

  void loadInitialData();
}

async function loadInitialData() {
  // Load playlist URL
  const playlistUrl = localStorage.getItem("playlistUrl");
  if (playlistUrl && settingsEls.playlistUrl) {
    settingsEls.playlistUrl.value = playlistUrl;
  }

  // Load blacklist
  await loadBlacklistForSettings();

  // Load caption preferences
  await loadCcPreferencesForSettings();

  // Load recordings
  await loadAllRecordings();
}

async function loadPlaylistForSettings() {
  try {
    const playlistInput = document.getElementById("playlistUrl");
    const url = playlistInput?.value?.trim();
    if (!url) {
      setStatus("Please enter a playlist URL.", true);
      return;
    }

    // Save the URL to localStorage
    // The main app will load it on next visit
    localStorage.setItem("playlistUrl", url);
    setStatus("Playlist URL saved! It will load when you return to the player.");
  } catch (err) {
    console.error(err);
    setStatus(`Error saving playlist: ${err.message}`, true);
  }
}

function exportSettings() {
  try {
    const settings = {
      playlistUrl: settingsEls.playlistUrl.value,
      hiddenChannels: [...settingsState.blacklistSet],
      ccPreferences: Array.from(document.querySelectorAll("#ccPreferencesList li")).map((li) => ({
        preference: li.dataset.preference,
      })),
    };

    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "iptv-settings.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setStatus("Settings exported successfully!");
  } catch (err) {
    console.error(err);
    setStatus(`Error exporting settings: ${err.message}`, true);
  }
}

async function importSettings(event) {
  try {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const settings = JSON.parse(text);

    // Import playlist URL
    if (settings.playlistUrl) {
      settingsEls.playlistUrl.value = settings.playlistUrl;
      localStorage.setItem("playlistUrl", settings.playlistUrl);
    }

    // Import hidden channels
    if (Array.isArray(settings.hiddenChannels)) {
      await replaceBlacklistForSettings(settings.hiddenChannels);
      settingsState.blacklistSet = new Set(settings.hiddenChannels);
      updateBlacklistCountForSettings();
      renderHiddenChannelsListForSettings();
    }

    // Import caption preferences
    if (Array.isArray(settings.ccPreferences)) {
      for (const pref of settings.ccPreferences) {
        if (pref.preference) {
          await addCcPreferenceForSettingsWithValue(pref.preference);
        }
      }
      await loadCcPreferencesForSettings();
    }

    setStatus("Settings imported successfully!");
    event.target.value = "";
  } catch (err) {
    console.error(err);
    setStatus(`Error importing settings: ${err.message}`, true);
    event.target.value = "";
  }
}

async function loadBlacklistForSettings() {
  try {
    const res = await fetch("/api/blacklist", { method: "GET" });
    if (!res.ok) {
      throw new Error(`Load blacklist failed: HTTP ${res.status}`);
    }

    const data = await res.json();
    const urls = data.blacklist || data.channels || [];
    settingsState.blacklistSet = new Set(urls.filter((entry) => typeof entry === "string" && entry.trim()));
    updateBlacklistCountForSettings();
    renderHiddenChannelsListForSettings();
  } catch (err) {
    console.error(err);
    setStatus("Blacklist API unavailable.", true);
  }
}

async function clearBlacklistForSettings() {
  if (!confirm("Are you sure you want to unhide all channels?")) return;

  try {
    const res = await fetch("/api/blacklist", { method: "DELETE" });
    if (!res.ok) {
      throw new Error(`Clear blacklist failed: HTTP ${res.status}`);
    }

    settingsState.blacklistSet.clear();
    updateBlacklistCountForSettings();
    renderHiddenChannelsListForSettings();
    setStatus("All channels unhidden.");
  } catch (err) {
    console.error(err);
    setStatus("Could not clear blacklist.", true);
  }
}

async function replaceBlacklistForSettings(urls) {
  const res = await fetch("/api/blacklist/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blacklist: urls }),
  });

  if (!res.ok) {
    throw new Error(`Replace blacklist failed: HTTP ${res.status}`);
  }
}

async function unhideChannelForSettings(url) {
  try {
    const res = await fetch(`/api/blacklist?url=${encodeURIComponent(url)}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      throw new Error(`Unhide failed: HTTP ${res.status}`);
    }

    settingsState.blacklistSet.delete(url);
    updateBlacklistCountForSettings();
    renderHiddenChannelsListForSettings();
    setStatus("Channel unhidden.");
  } catch (err) {
    console.error(err);
    setStatus("Could not unhide this channel.", true);
  }
}

function updateBlacklistCountForSettings() {
  const blacklistCountEl = document.getElementById("blacklistCount");
  if (!blacklistCountEl) {
    return;
  }

  const count = settingsState.blacklistSet.size;
  blacklistCountEl.textContent = `${count} hidden channel${count === 1 ? "" : "s"}`;
}

function renderHiddenChannelsListForSettings() {
  const hidden = Array.from(settingsState.blacklistSet);
  
  // Look up the element at runtime in case it wasn't available during init
  const hiddenList = document.getElementById("hiddenChannelsList");
  if (!hiddenList) {
    console.error("hiddenChannelsList element not found");
    return;
  }

  if (hidden.length === 0) {
    hiddenList.innerHTML = "";
    return;
  }

  hiddenList.innerHTML = "";
  const frag = document.createDocumentFragment();

  for (const url of hidden) {
    const li = document.createElement("li");
    li.dataset.url = url;

    const urlDiv = document.createElement("div");
    urlDiv.className = "channel-name";
    urlDiv.textContent = url;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "favorites-action-btn";
    btn.dataset.action = "unhide";
    btn.dataset.url = url;
    btn.textContent = "Unhide";

    li.appendChild(urlDiv);
    li.appendChild(btn);
    frag.appendChild(li);
  }

  hiddenList.appendChild(frag);
}

async function onHiddenChannelActionClick(event) {
  const btn = event.target.closest("button");
  if (!btn || btn.dataset.action !== "unhide") return;

  const url = btn.dataset.url;
  if (!url) return;

  await unhideChannelForSettings(url);
}

async function loadCcPreferencesForSettings() {
  try {
    // Load caption preferences from localStorage (same as main app)
    const CC_PREFERENCES_KEY = "iptv.ccPreferences";
    const saved = window.localStorage.getItem(CC_PREFERENCES_KEY);
    let preferences = [];
    
    if (saved) {
      try {
        preferences = JSON.parse(saved);
        if (!Array.isArray(preferences)) {
          preferences = [];
        }
      } catch {
        preferences = [];
      }
    }

    const ccList = document.getElementById("ccPreferencesList");
    if (!ccList) {
      return;
    }

    ccList.innerHTML = "";
    if (preferences.length === 0) {
      return;
    }

    const frag = document.createDocumentFragment();

    for (const pref of preferences) {
      const li = document.createElement("li");
      li.dataset.preference = pref;

      const prefSpan = document.createElement("span");
      prefSpan.textContent = pref;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "danger";
      btn.dataset.action = "remove-cc";
      btn.dataset.preference = pref;
      btn.textContent = "Remove";

      li.appendChild(prefSpan);
      li.appendChild(btn);
      frag.appendChild(li);
    }

    settingsEls.ccPreferencesList.appendChild(frag);
  } catch (err) {
    console.error(err);
  }
}

async function addCcPreferenceForSettings() {
  const ccInput = document.getElementById("ccPreferenceInput");
  const value = ccInput?.value?.trim();
  if (!value) {
    setStatus("Enter a caption preference.", true);
    return;
  }

  await addCcPreferenceForSettingsWithValue(value);
  if (ccInput) {
    ccInput.value = "";
  }
}

async function addCcPreferenceForSettingsWithValue(value) {
  try {
    const CC_PREFERENCES_KEY = "iptv.ccPreferences";
    const saved = window.localStorage.getItem(CC_PREFERENCES_KEY) || "[]";
    let preferences = JSON.parse(saved);
    if (!Array.isArray(preferences)) {
      preferences = [];
    }

    // Avoid duplicates
    if (!preferences.includes(value)) {
      preferences.push(value);
      window.localStorage.setItem(CC_PREFERENCES_KEY, JSON.stringify(preferences));
    }

    await loadCcPreferencesForSettings();
    setStatus(`Added caption preference: ${value}`);
  } catch (err) {
    console.error(err);
    setStatus(`Error adding caption preference: ${err.message}`, true);
  }
}

async function onCcPreferenceActionClick(event) {
  const btn = event.target.closest("button");
  if (!btn || btn.dataset.action !== "remove-cc") return;

  const pref = btn.dataset.preference;
  if (!pref) return;

  try {
    const CC_PREFERENCES_KEY = "iptv.ccPreferences";
    const saved = window.localStorage.getItem(CC_PREFERENCES_KEY) || "[]";
    let preferences = JSON.parse(saved);
    if (!Array.isArray(preferences)) {
      preferences = [];
    }

    preferences = preferences.filter(p => p !== pref);
    window.localStorage.setItem(CC_PREFERENCES_KEY, JSON.stringify(preferences));

    await loadCcPreferencesForSettings();
    setStatus("Caption preference removed.");
  } catch (err) {
    console.error(err);
    setStatus("Could not remove caption preference.", true);
  }
}

async function loadAllRecordings() {
  try {
    const res = await fetch("/api/recordings/list");
    if (!res.ok) {
      throw new Error(`Load recordings failed: HTTP ${res.status}`);
    }

    const data = await res.json();
    const allRecordings = data.recordings || [];

    const inProgress = allRecordings.filter((r) => r.status === "recording" || r.status === "pending");
    const completed = allRecordings.filter((r) => r.status === "complete");

    renderRecordingsInProgress(inProgress);
    renderRecordingsCompleted(completed);
  } catch (err) {
    console.error("Load all recordings error:", err);
    settingsEls.recordingsInProgressList.innerHTML =
      '<li class="recordings-empty">Error loading recordings</li>';
  }
}

function renderRecordingsInProgress(recordings) {
  const list = document.getElementById("recordingsInProgressList");
  if (!list) return;

  if (recordings.length === 0) {
    list.innerHTML = '<li class="recordings-empty">No recordings in progress</li>';
    return;
  }

  list.innerHTML = "";
  const frag = document.createDocumentFragment();

  for (const rec of recordings) {
    const li = document.createElement("li");
    li.className = "recording-item";
    li.dataset.recordingId = rec.id;

    const infoDiv = document.createElement("div");
    infoDiv.className = "recording-item-info";

    const nameDiv = document.createElement("div");
    nameDiv.className = "recording-item-name";
    nameDiv.textContent = `${rec.channel_name} - ${rec.duration_minutes}m`;

    const statusDiv = document.createElement("div");
    statusDiv.className = "recording-item-status in-progress";
    statusDiv.textContent =
      rec.status === "recording"
        ? "Recording in progress..."
        : rec.status === "pending"
          ? "Pending (waiting for recorder)..."
          : rec.status;

    infoDiv.appendChild(nameDiv);
    infoDiv.appendChild(statusDiv);

    const actionsDiv = document.createElement("div");
    actionsDiv.className = "recording-item-actions";

    const cancelKeepBtn = document.createElement("button");
    cancelKeepBtn.type = "button";
    cancelKeepBtn.dataset.action = "cancel-keep";
    cancelKeepBtn.dataset.recordingId = rec.id;
    cancelKeepBtn.textContent = "Cancel & Keep";

    const cancelDelBtn = document.createElement("button");
    cancelDelBtn.type = "button";
    cancelDelBtn.className = "danger";
    cancelDelBtn.dataset.action = "cancel-delete";
    cancelDelBtn.dataset.recordingId = rec.id;
    cancelDelBtn.textContent = "Cancel & Delete";

    actionsDiv.appendChild(cancelKeepBtn);
    actionsDiv.appendChild(cancelDelBtn);

    li.appendChild(infoDiv);
    li.appendChild(actionsDiv);
    frag.appendChild(li);
  }

  list.appendChild(frag);
}

function renderRecordingsCompleted(recordings) {
  const list = document.getElementById("recordingsCompletedList");
  if (!list) return;

  if (recordings.length === 0) {
    list.innerHTML = '<li class="recordings-empty">No completed recordings</li>';
    return;
  }

  list.innerHTML = "";
  const frag = document.createDocumentFragment();

  for (const rec of recordings) {
    const li = document.createElement("li");
    li.className = "recording-item";
    li.dataset.recordingId = rec.id;

    const infoDiv = document.createElement("div");
    infoDiv.className = "recording-item-info";

    const nameDiv = document.createElement("div");
    nameDiv.className = "recording-item-name";
    nameDiv.textContent = `${rec.channel_name} - ${rec.duration_minutes}m`;

    const statusDiv = document.createElement("div");
    statusDiv.className = "recording-item-status complete";
    const completedDate = rec.completed_at
      ? new Date(rec.completed_at).toLocaleDateString()
      : "Unknown";
    statusDiv.textContent = `Completed - ${completedDate}`;

    infoDiv.appendChild(nameDiv);
    infoDiv.appendChild(statusDiv);

    const actionsDiv = document.createElement("div");
    actionsDiv.className = "recording-item-actions";

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.dataset.action = "rename";
    renameBtn.dataset.recordingId = rec.id;
    renameBtn.textContent = "Rename";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "danger";
    deleteBtn.dataset.action = "delete";
    deleteBtn.dataset.recordingId = rec.id;
    deleteBtn.textContent = "Delete";

    actionsDiv.appendChild(renameBtn);
    actionsDiv.appendChild(deleteBtn);

    li.appendChild(infoDiv);
    li.appendChild(actionsDiv);
    frag.appendChild(li);
  }

  list.appendChild(frag);
}

async function onRecordingActionClick(event) {
  const btn = event.target.closest("button");
  if (!btn) return;

  const action = btn.dataset.action;
  const recordingId = btn.dataset.recordingId;

  if (!action || !recordingId) return;

  try {
    if (action === "cancel-delete") {
      await cancelRecording(recordingId, true);
      setStatus("Recording cancelled and file deleted.");
    } else if (action === "cancel-keep") {
      await cancelRecording(recordingId, false);
      setStatus("Recording cancelled. File kept.");
    } else if (action === "delete") {
      if (confirm("Are you sure you want to delete this recording? This cannot be undone.")) {
        await deleteRecording(recordingId);
        setStatus("Recording deleted.");
      }
    } else if (action === "rename") {
      const newName = prompt("Enter new name for this recording:");
      if (newName && newName.trim()) {
        await renameRecording(recordingId, newName.trim());
        setStatus("Recording renamed.");
      }
    }

    await loadAllRecordings();
  } catch (err) {
    console.error("Recording action error:", err);
    setStatus(`Error: ${err.message}`, true);
  }
}

async function cancelRecording(recordingId, deleteFile = false) {
  const res = await fetch(`/api/recordings/${recordingId}/cancel`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ delete_file: deleteFile }),
  });

  if (!res.ok) {
    throw new Error(`Cancel recording failed: HTTP ${res.status}`);
  }
}

async function deleteRecording(recordingId) {
  const res = await fetch(`/api/recordings/${recordingId}`, { method: "DELETE" });

  if (!res.ok) {
    throw new Error(`Delete recording failed: HTTP ${res.status}`);
  }
}

async function renameRecording(recordingId, newName) {
  const res = await fetch(`/api/recordings/${recordingId}/rename`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: newName }),
  });

  if (!res.ok) {
    throw new Error(`Rename recording failed: HTTP ${res.status}`);
  }
}

init();
