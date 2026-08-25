const SIDEBAR_WIDTH_KEY = "iptv.sidebarWidth";

const state = {
  channels: [],
  filtered: [],
  selectedUrl: "",
  hls: null,
  dash: null,
  renderChunkSize: 140,
  renderedCount: 0,
  filterTimer: null,
  favorites: [],
  favoritesMap: new Map(),
  blacklistSet: new Set(),
  draggingFavoriteUrl: "",
  playbackGuardTimer: null,
  lastTriedChannel: null,
  overlayChannelUrl: "",
  hasSelectedChannel: false,
  isResizingSidebar: false,
};

const els = {
  playlistUrl: document.getElementById("playlistUrl"),
  loadBtn: document.getElementById("loadBtn"),
  status: document.getElementById("status"),
  searchInput: document.getElementById("searchInput"),
  groupSelect: document.getElementById("groupSelect"),
  channelList: document.getElementById("channelList"),
  favoritesSection: document.getElementById("favoritesSection"),
  favoritesList: document.getElementById("favoritesList"),
  exportSettingsBtn: document.getElementById("exportSettingsBtn"),
  importSettingsBtn: document.getElementById("importSettingsBtn"),
  importSettingsInput: document.getElementById("importSettingsInput"),
  blacklistCount: document.getElementById("blacklistCount"),
  clearBlacklistBtn: document.getElementById("clearBlacklistBtn"),
  hiddenChannelsSection: document.getElementById("hiddenChannelsSection"),
  hiddenChannelsList: document.getElementById("hiddenChannelsList"),
  splitHandle: document.getElementById("splitHandle"),
  sidebar: document.querySelector(".sidebar"),
  playbackOverlay: document.getElementById("playbackOverlay"),
  playerPlaceholder: document.getElementById("playerPlaceholder"),
  overlayMessage: document.getElementById("overlayMessage"),
  blacklistChannelBtn: document.getElementById("blacklistChannelBtn"),
  dismissOverlayBtn: document.getElementById("dismissOverlayBtn"),
  channelCount: document.getElementById("channelCount"),
  video: document.getElementById("video"),
  channelName: document.getElementById("channelName"),
  channelMeta: document.getElementById("channelMeta"),
  channelLogo: document.getElementById("channelLogo"),
};

init();

function init() {
  els.loadBtn.addEventListener("click", loadPlaylist);
  els.searchInput.addEventListener("input", scheduleFilter);
  els.groupSelect.addEventListener("change", applyFilters);
  els.channelList.addEventListener("click", (event) => {
    void onChannelListClick(event);
  });
  els.channelList.addEventListener("scroll", maybeRenderMore);
  els.favoritesList.addEventListener("click", (event) => {
    void onFavoritesListClick(event);
  });
  els.favoritesList.addEventListener("dragstart", onFavoriteDragStart);
  els.favoritesList.addEventListener("dragover", onFavoriteDragOver);
  els.favoritesList.addEventListener("drop", (event) => {
    void onFavoriteDrop(event);
  });
  els.favoritesList.addEventListener("dragend", onFavoriteDragEnd);
  els.exportSettingsBtn.addEventListener("click", exportSettings);
  els.importSettingsBtn.addEventListener("click", () => {
    els.importSettingsInput.click();
  });
  els.importSettingsInput.addEventListener("change", (event) => {
    void importSettings(event);
  });
  els.clearBlacklistBtn.addEventListener("click", () => {
    void clearBlacklist();
  });
  els.hiddenChannelsList.addEventListener("click", (event) => {
    void onHiddenChannelsListClick(event);
  });
  els.blacklistChannelBtn.addEventListener("click", () => {
    void blacklistOverlayChannel();
  });
  els.dismissOverlayBtn.addEventListener("click", hidePlaybackOverlay);
  els.video.addEventListener("playing", onVideoPlaying);
  els.video.addEventListener("error", onVideoElementError);

  initSplitter();
  void bootstrap();
}

async function bootstrap() {
  await Promise.all([loadFavorites(), loadBlacklist()]);
  await loadPlaylist();
}

function initSplitter() {
  const savedWidth = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
  if (savedWidth) {
    applySidebarWidth(savedWidth);
  }

  els.splitHandle.addEventListener("pointerdown", (event) => {
    if (window.matchMedia("(max-width: 960px)").matches) {
      return;
    }

    event.preventDefault();
    state.isResizingSidebar = true;
    els.splitHandle.classList.add("dragging");
    els.splitHandle.setPointerCapture(event.pointerId);
  });

  els.splitHandle.addEventListener("pointermove", (event) => {
    if (!state.isResizingSidebar) {
      return;
    }

    const layoutRect = document.querySelector(".layout").getBoundingClientRect();
    const minWidth = 260;
    const maxWidth = Math.max(minWidth, Math.min(window.innerWidth * 0.68, layoutRect.width - 280));
    const nextWidth = clamp(event.clientX - layoutRect.left, minWidth, maxWidth);

    applySidebarWidth(nextWidth);
  });

  const finishResize = () => {
    if (!state.isResizingSidebar) return;
    state.isResizingSidebar = false;
    els.splitHandle.classList.remove("dragging");
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(els.sidebar.offsetWidth)));
  };

  els.splitHandle.addEventListener("pointerup", finishResize);
  els.splitHandle.addEventListener("pointercancel", finishResize);
}

function applySidebarWidth(widthPx) {
  const width = Math.round(widthPx);
  els.sidebar.style.width = `${width}px`;
  els.sidebar.style.flexBasis = `${width}px`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function scheduleFilter() {
  if (state.filterTimer) {
    clearTimeout(state.filterTimer);
  }

  state.filterTimer = setTimeout(() => {
    applyFilters();
  }, 120);
}

async function loadPlaylist() {
  const url = (els.playlistUrl.value || "").trim();
  if (!url) {
    setStatus("Playlist URL is required.", true);
    return;
  }

  setStatus("Fetching playlist...");

  try {
    const startedAt = performance.now();
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const text = await res.text();
    const channels = parseM3U(text);
    const normalizedChannels = channels.map((channel) => ({
      ...channel,
      searchName: (channel.name || "").toLowerCase(),
      searchDisplay: (channel.display || "").toLowerCase(),
      streamType: typeForUrl(channel.url),
    }));

    if (!normalizedChannels.length) {
      setStatus("Loaded 0 channels. Check URL or playlist format.", true);
      return;
    }

    state.channels = normalizedChannels;
    populateGroups(normalizedChannels);
    applyFilters();
    renderFavorites();
    renderHiddenChannelsList();

    const elapsedMs = Math.round(performance.now() - startedAt);
    setStatus(`Loaded ${normalizedChannels.length} channels in ${elapsedMs}ms.`);
  } catch (err) {
    console.error(err);
    setStatus("Could not load playlist. The source may block browser CORS requests.", true);
  }
}

async function loadFavorites() {
  try {
    const res = await fetch("/api/favorites", { method: "GET" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const body = await res.json();
    setFavorites(normalizeFavorites(body?.favorites));
    renderFavorites();
  } catch (err) {
    console.error(err);
    setStatus("Favorites API unavailable. Favorites sync is offline.", true);
  }
}

async function loadBlacklist() {
  try {
    const res = await fetch("/api/blacklist", { method: "GET" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const body = await res.json();
    const urls = Array.isArray(body?.channels) ? body.channels : [];
    state.blacklistSet = new Set(urls.filter((entry) => typeof entry === "string" && entry.trim()));
    updateBlacklistCount();
    renderHiddenChannelsList();
  } catch (err) {
    console.error(err);
    setStatus("Blacklist API unavailable. Hidden channel sync is offline.", true);
  }
}

function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let pendingMeta = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      pendingMeta = parseExtInf(line);
      continue;
    }

    if (line.startsWith("#")) continue;

    if (pendingMeta) {
      out.push({ ...pendingMeta, url: line });
      pendingMeta = null;
    }
  }

  return out;
}

function parseExtInf(line) {
  const afterComma = line.includes(",") ? line.slice(line.indexOf(",") + 1).trim() : "Unknown";

  const tvgName = attr(line, "tvg-name") || afterComma;
  const tvgLogo = attr(line, "tvg-logo") || "";
  const groupTitle = attr(line, "group-title") || "Other";
  const tvgId = attr(line, "tvg-id") || "";

  return {
    name: tvgName,
    logo: tvgLogo,
    group: groupTitle,
    id: tvgId,
    display: afterComma || tvgName,
  };
}

function attr(line, key) {
  const match = line.match(new RegExp(`${key}="([^"]*)"`));
  return match ? match[1] : "";
}

function populateGroups(channels) {
  const groups = [...new Set(channels.map((c) => c.group).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );

  els.groupSelect.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All Groups";
  els.groupSelect.appendChild(allOption);

  for (const group of groups) {
    const opt = document.createElement("option");
    opt.value = group;
    opt.textContent = group;
    els.groupSelect.appendChild(opt);
  }
}

function applyFilters() {
  const search = els.searchInput.value.trim().toLowerCase();
  const group = els.groupSelect.value;
  const filtered = [];

  for (const channel of state.channels) {
    if (state.blacklistSet.has(channel.url)) {
      continue;
    }

    const matchesSearch =
      !search || channel.searchName.includes(search) || channel.searchDisplay.includes(search);
    const matchesGroup = group === "all" || channel.group === group;

    if (matchesSearch && matchesGroup) {
      filtered.push(channel);
    }
  }

  state.filtered = filtered;
  renderList();
}

function renderList() {
  els.channelList.innerHTML = "";
  state.renderedCount = 0;

  if (!state.filtered.length) {
    els.channelCount.textContent = "0 channels";
    const li = document.createElement("li");
    li.textContent = state.blacklistSet.size
      ? "No channels match filters (some are hidden)."
      : "No channels match your filters.";
    els.channelList.appendChild(li);
    return;
  }

  renderNextChunk();
}

function renderNextChunk() {
  if (state.renderedCount >= state.filtered.length) {
    return;
  }

  const frag = document.createDocumentFragment();
  const end = Math.min(state.renderedCount + state.renderChunkSize, state.filtered.length);

  for (let idx = state.renderedCount; idx < end; idx += 1) {
    const channel = state.filtered[idx];
    const li = document.createElement("li");
    li.className = "channel-item";
    li.dataset.channelIndex = String(idx);
    li.dataset.url = channel.url;

    if (channel.url === state.selectedUrl) {
      li.classList.add("active");
    }

    const titleWrap = document.createElement("div");
    titleWrap.className = "channel-item-main";

    const title = document.createElement("div");
    title.className = "channel-title";
    title.textContent = channel.display || channel.name;

    const sub = document.createElement("div");
    sub.className = "channel-group";
    sub.textContent = channel.group || "Other";

    titleWrap.appendChild(title);
    titleWrap.appendChild(sub);

    const rightWrap = document.createElement("div");
    rightWrap.className = "channel-item-right";

    const playTag = document.createElement("div");
    playTag.className = "channel-group";
    playTag.textContent = channel.streamType.toUpperCase();

    rightWrap.appendChild(playTag);
    rightWrap.appendChild(createFavoriteButton(channel.url));

    li.appendChild(titleWrap);
    li.appendChild(rightWrap);
    frag.appendChild(li);
  }

  els.channelList.appendChild(frag);
  state.renderedCount = end;
  updateChannelCount();
}

function maybeRenderMore() {
  if (!state.filtered.length || state.renderedCount >= state.filtered.length) {
    return;
  }

  const nearBottom =
    els.channelList.scrollTop + els.channelList.clientHeight >= els.channelList.scrollHeight - 160;

  if (nearBottom) {
    renderNextChunk();
  }
}

function updateChannelCount() {
  if (!state.filtered.length) {
    els.channelCount.textContent = "0 channels";
    return;
  }

  if (state.renderedCount < state.filtered.length) {
    els.channelCount.textContent = `${state.filtered.length} channels (showing ${state.renderedCount})`;
    return;
  }

  els.channelCount.textContent = `${state.filtered.length} channels`;
}

function onChannelListClick(event) {
  const favBtn = event.target.closest(".favorite-toggle");
  if (favBtn) {
    const url = favBtn.dataset.url;
    if (url) {
      return toggleFavorite(url);
    }
    return;
  }

  const item = event.target.closest(".channel-item");
  if (!item) return;

  const idx = Number(item.dataset.channelIndex);
  if (Number.isNaN(idx)) return;

  const channel = state.filtered[idx];
  if (!channel) return;

  playChannel(channel);
}

function onFavoritesListClick(event) {
  const favBtn = event.target.closest(".favorite-toggle");
  if (favBtn) {
    const url = favBtn.dataset.url;
    if (url) {
      return toggleFavorite(url);
    }
    return;
  }

  const item = event.target.closest(".channel-item");
  if (!item) return;

  const url = item.dataset.url;
  if (!url || state.blacklistSet.has(url)) return;

  const channel = findChannelByUrl(url) || state.favoritesMap.get(url);
  if (!channel) return;

  playChannel(channel);
}

function playChannel(channel) {
  hidePlaybackOverlay();
  showPlayerPlaceholder(false);
  teardownPlayers();

  state.hasSelectedChannel = true;
  state.selectedUrl = channel.url;
  state.lastTriedChannel = channel;
  updateActiveChannel();

  els.channelName.textContent = channel.display || channel.name;
  els.channelMeta.textContent = `${channel.group || "Other"} ${channel.id ? `• ${channel.id}` : ""}`;

  if (channel.logo) {
    els.channelLogo.src = channel.logo;
    els.channelLogo.hidden = false;
  } else {
    els.channelLogo.hidden = true;
    els.channelLogo.removeAttribute("src");
  }

  const type = typeForUrl(channel.url);
  startPlaybackGuard();
  setStatus(`Connecting (${type})...`);

  try {
    if (type === "hls") {
      playHls(channel);
      return;
    }

    if (type === "dash") {
      playDash(channel);
      return;
    }

    playNative(channel.url);
  } catch (err) {
    console.error(err);
    onPlaybackFailure(channel, "Browser rejected this stream.");
  }
}

function updateActiveChannel() {
  const items = document.querySelectorAll(".channel-item");
  items.forEach((item) => {
    const url = item.dataset.url;
    const isActive = Boolean(url) && url === state.selectedUrl;
    item.classList.toggle("active", Boolean(isActive));
  });
}

function renderFavorites() {
  els.favoritesList.innerHTML = "";
  const visibleFavorites = state.favorites.filter((favorite) => !state.blacklistSet.has(favorite.url));

  els.favoritesSection.hidden = visibleFavorites.length === 0;
  if (!visibleFavorites.length) {
    return;
  }

  const frag = document.createDocumentFragment();

  for (const favorite of visibleFavorites) {
    const current = findChannelByUrl(favorite.url) || favorite;

    const li = document.createElement("li");
    li.className = "channel-item favorite-item";
    li.dataset.url = current.url;
    li.draggable = true;
    if (current.url === state.selectedUrl) {
      li.classList.add("active");
    }

    const titleWrap = document.createElement("div");
    titleWrap.className = "channel-item-main";

    const title = document.createElement("div");
    title.className = "channel-title";
    title.textContent = current.display || current.name || "Favorite channel";

    const sub = document.createElement("div");
    sub.className = "channel-group";
    sub.textContent = current.group || "Other";

    titleWrap.appendChild(title);
    titleWrap.appendChild(sub);

    const rightWrap = document.createElement("div");
    rightWrap.className = "channel-item-right";

    const playTag = document.createElement("div");
    playTag.className = "channel-group";
    playTag.textContent = (current.streamType || typeForUrl(current.url)).toUpperCase();

    rightWrap.appendChild(playTag);
    rightWrap.appendChild(createFavoriteButton(current.url));

    li.appendChild(titleWrap);
    li.appendChild(rightWrap);
    frag.appendChild(li);
  }

  els.favoritesList.appendChild(frag);
}

function createFavoriteButton(url) {
  const isFavorite = state.favoritesMap.has(url);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `favorite-toggle${isFavorite ? " is-favorite" : ""}`;
  btn.dataset.url = url;
  btn.setAttribute("aria-label", isFavorite ? "Remove favorite" : "Add favorite");
  btn.textContent = isFavorite ? "★" : "☆";
  return btn;
}

async function toggleFavorite(url) {
  if (!url) return;

  const currentlyFavorite = state.favoritesMap.has(url);

  try {
    if (currentlyFavorite) {
      await deleteFavorite(url);
      setFavorites(state.favorites.filter((entry) => entry.url !== url));
    } else {
      const payload = toFavoritePayload(findChannelByUrl(url) || state.favoritesMap.get(url) || { url });
      await saveFavorite(payload);
      setFavorites([...state.favorites, payload]);
    }

    renderFavorites();
    updateVisibleFavoriteIcons();
  } catch (err) {
    console.error(err);
    setStatus("Could not update favorites right now.", true);
  }
}

async function saveFavorite(favorite) {
  const res = await fetch("/api/favorites", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(favorite),
  });

  if (!res.ok) {
    throw new Error(`Save favorite failed: HTTP ${res.status}`);
  }
}

async function deleteFavorite(url) {
  const res = await fetch(`/api/favorites?url=${encodeURIComponent(url)}`, { method: "DELETE" });

  if (!res.ok) {
    throw new Error(`Delete favorite failed: HTTP ${res.status}`);
  }
}

function toFavoritePayload(channel) {
  return {
    url: channel.url,
    name: channel.name || channel.display || "",
    display: channel.display || channel.name || "",
    group: channel.group || "Other",
    logo: channel.logo || "",
    id: channel.id || "",
    streamType: channel.streamType || typeForUrl(channel.url),
  };
}

function setFavorites(favorites) {
  state.favorites = normalizeFavorites(favorites);
  state.favoritesMap = new Map(state.favorites.map((favorite) => [favorite.url, favorite]));
}

function normalizeFavorites(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];

  for (const raw of input) {
    const favorite = toFavoritePayload(raw || {});
    if (!favorite.url || seen.has(favorite.url)) {
      continue;
    }

    seen.add(favorite.url);
    normalized.push(favorite);
  }

  return normalized;
}

function onFavoriteDragStart(event) {
  const item = event.target.closest(".favorite-item");
  if (!item) {
    event.preventDefault();
    return;
  }

  const url = item.dataset.url || "";
  if (!url) {
    event.preventDefault();
    return;
  }

  state.draggingFavoriteUrl = url;
  item.classList.add("dragging");

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", url);
  }
}

function onFavoriteDragOver(event) {
  if (!state.draggingFavoriteUrl) {
    return;
  }

  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }

  clearFavoriteDropClasses();
  const item = event.target.closest(".favorite-item");
  if (!item || item.dataset.url === state.draggingFavoriteUrl) {
    return;
  }

  const rect = item.getBoundingClientRect();
  const before = event.clientY < rect.top + rect.height / 2;
  item.classList.add(before ? "drop-before" : "drop-after");
}

async function onFavoriteDrop(event) {
  if (!state.draggingFavoriteUrl) {
    return;
  }

  event.preventDefault();

  const target = event.target.closest(".favorite-item");
  const dragUrl = state.draggingFavoriteUrl;

  clearFavoriteDropClasses();
  clearFavoriteDraggingClass();
  state.draggingFavoriteUrl = "";

  if (!target) {
    return;
  }

  const targetUrl = target.dataset.url;
  if (!targetUrl || targetUrl === dragUrl) {
    return;
  }

  const next = reorderFavoritesByDropPosition(dragUrl, targetUrl, event.clientY, target);
  if (!next) {
    return;
  }

  const prev = state.favorites;
  setFavorites(next);
  renderFavorites();
  updateVisibleFavoriteIcons();

  try {
    await saveFavoritesOrder(state.favorites.map((favorite) => favorite.url));
  } catch (err) {
    console.error(err);
    setFavorites(prev);
    renderFavorites();
    updateVisibleFavoriteIcons();
    setStatus("Could not save favorite order.", true);
  }
}

function onFavoriteDragEnd() {
  clearFavoriteDraggingClass();
  clearFavoriteDropClasses();
  state.draggingFavoriteUrl = "";
}

function clearFavoriteDropClasses() {
  const items = els.favoritesList.querySelectorAll(".favorite-item");
  items.forEach((item) => {
    item.classList.remove("drop-before", "drop-after");
  });
}

function clearFavoriteDraggingClass() {
  const dragging = els.favoritesList.querySelector(".favorite-item.dragging");
  if (dragging) {
    dragging.classList.remove("dragging");
  }
}

function reorderFavoritesByDropPosition(dragUrl, targetUrl, clientY, targetItem) {
  const fromIndex = state.favorites.findIndex((favorite) => favorite.url === dragUrl);
  const targetIndex = state.favorites.findIndex((favorite) => favorite.url === targetUrl);

  if (fromIndex < 0 || targetIndex < 0) {
    return null;
  }

  const rect = targetItem.getBoundingClientRect();
  const insertAfter = clientY > rect.top + rect.height / 2;

  const next = [...state.favorites];
  const [moved] = next.splice(fromIndex, 1);
  let insertAt = targetIndex;

  if (fromIndex < targetIndex) {
    insertAt -= 1;
  }

  if (insertAfter) {
    insertAt += 1;
  }

  next.splice(insertAt, 0, moved);
  return next;
}

async function saveFavoritesOrder(urls) {
  const res = await fetch("/api/favorites/order", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  });

  if (!res.ok) {
    throw new Error(`Save favorite order failed: HTTP ${res.status}`);
  }
}

function exportSettings() {
  const payload = {
    schema: "iptv-settings-v1",
    exportedAt: new Date().toISOString(),
    settings: {
      playlistUrl: (els.playlistUrl.value || "").trim(),
      sidebarWidth: Math.round(els.sidebar.offsetWidth),
      favorites: state.favorites,
      hiddenChannels: [...state.blacklistSet],
    },
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);

  link.href = URL.createObjectURL(blob);
  link.download = `iptv-settings-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

async function importSettings(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);

    // Backward-compatible fallback for older favorites-only exports.
    const rawSettings = parsed?.settings || parsed;
    const favoritesSource = Array.isArray(rawSettings) ? rawSettings : rawSettings?.favorites;
    const hiddenSource = rawSettings?.hiddenChannels;

    const favorites = normalizeFavorites(favoritesSource);
    const hiddenChannels = Array.isArray(hiddenSource)
      ? hiddenSource.filter((entry) => typeof entry === "string" && entry.trim())
      : [];

    await saveFavoritesBulk(favorites, "replace");
    await replaceBlacklist(hiddenChannels);

    setFavorites(favorites);
    state.blacklistSet = new Set(hiddenChannels);

    const playlistUrl = typeof rawSettings?.playlistUrl === "string" ? rawSettings.playlistUrl.trim() : "";
    const shouldReloadPlaylist = Boolean(playlistUrl && playlistUrl !== (els.playlistUrl.value || "").trim());
    if (playlistUrl) {
      els.playlistUrl.value = playlistUrl;
    }

    const sidebarWidth = Number(rawSettings?.sidebarWidth);
    if (sidebarWidth) {
      applySidebarWidth(sidebarWidth);
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(sidebarWidth)));
    }

    if (shouldReloadPlaylist) {
      await loadPlaylist();
    }

    if (state.selectedUrl && state.blacklistSet.has(state.selectedUrl)) {
      teardownPlayers();
      state.selectedUrl = "";
      state.lastTriedChannel = null;
      state.hasSelectedChannel = false;
      els.channelName.textContent = "Select a channel";
      els.channelMeta.textContent = "Waiting for selection.";
      els.channelLogo.hidden = true;
      els.channelLogo.removeAttribute("src");
      showPlayerPlaceholder(true);
    }

    hidePlaybackOverlay();
    renderFavorites();
    renderHiddenChannelsList();
    updateBlacklistCount();
    updateVisibleFavoriteIcons();
    applyFilters();

    setStatus(`Imported settings (${favorites.length} favorites, ${hiddenChannels.length} hidden).`);
  } catch (err) {
    console.error(err);
    setStatus("Import failed. Use a valid settings JSON file.", true);
  } finally {
    input.value = "";
  }
}

async function saveFavoritesBulk(favorites, mode = "replace") {
  const res = await fetch("/api/favorites/bulk", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ favorites, mode }),
  });

  if (!res.ok) {
    throw new Error(`Import favorites failed: HTTP ${res.status}`);
  }
}

async function replaceBlacklist(urls) {
  const res = await fetch("/api/blacklist/bulk", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channels: urls }),
  });

  if (!res.ok) {
    throw new Error(`Import hidden channels failed: HTTP ${res.status}`);
  }
}

function updateVisibleFavoriteIcons() {
  const buttons = document.querySelectorAll(".favorite-toggle");
  buttons.forEach((button) => {
    const url = button.dataset.url;
    const isFavorite = Boolean(url) && state.favoritesMap.has(url);
    button.classList.toggle("is-favorite", isFavorite);
    button.setAttribute("aria-label", isFavorite ? "Remove favorite" : "Add favorite");
    button.textContent = isFavorite ? "★" : "☆";
  });
}

function findChannelByUrl(url) {
  if (!url) return null;
  return state.channels.find((channel) => channel.url === url) || null;
}

async function addToBlacklist(url) {
  const res = await fetch("/api/blacklist", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    throw new Error(`Blacklist update failed: HTTP ${res.status}`);
  }
}

async function clearBlacklist() {
  try {
    const res = await fetch("/api/blacklist", { method: "DELETE" });
    if (!res.ok) {
      throw new Error(`Clear blacklist failed: HTTP ${res.status}`);
    }

    state.blacklistSet.clear();
    updateBlacklistCount();
    renderHiddenChannelsList();
    applyFilters();
    renderFavorites();
    updateVisibleFavoriteIcons();
    setStatus("Hidden channel list cleared.");
  } catch (err) {
    console.error(err);
    setStatus("Could not clear hidden channels.", true);
  }
}

function updateBlacklistCount() {
  const count = state.blacklistSet.size;
  els.blacklistCount.textContent = `${count} hidden channel${count === 1 ? "" : "s"}`;
}

function renderHiddenChannelsList() {
  els.hiddenChannelsList.innerHTML = "";

  const hiddenUrls = [...state.blacklistSet];
  els.hiddenChannelsSection.hidden = hiddenUrls.length === 0;
  if (!hiddenUrls.length) {
    return;
  }

  const frag = document.createDocumentFragment();

  for (const url of hiddenUrls) {
    const channel = findChannelByUrl(url);

    const li = document.createElement("li");
    li.className = "hidden-channel-item";

    const label = document.createElement("span");
    label.className = "hidden-channel-name";
    label.textContent = channel?.display || channel?.name || url;
    label.title = url;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "unhide-btn";
    btn.dataset.url = url;
    btn.setAttribute("aria-label", "Unhide channel");

    const icon = document.createElement("span");
    icon.className = "eye-slash";

    btn.appendChild(icon);
    li.appendChild(label);
    li.appendChild(btn);
    frag.appendChild(li);
  }

  els.hiddenChannelsList.appendChild(frag);
}

function onHiddenChannelsListClick(event) {
  const button = event.target.closest(".unhide-btn");
  if (!button) {
    return;
  }

  const url = button.dataset.url;
  if (!url) {
    return;
  }

  return unhideChannel(url);
}

async function unhideChannel(url) {
  try {
    const res = await fetch(`/api/blacklist?url=${encodeURIComponent(url)}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      throw new Error(`Unhide failed: HTTP ${res.status}`);
    }

    state.blacklistSet.delete(url);
    updateBlacklistCount();
    renderHiddenChannelsList();
    applyFilters();
    renderFavorites();
    setStatus("Channel unhidden.");
  } catch (err) {
    console.error(err);
    setStatus("Could not unhide this channel.", true);
  }
}

function startPlaybackGuard() {
  clearPlaybackGuard();
  state.playbackGuardTimer = window.setTimeout(() => {
    if (!state.lastTriedChannel) return;
    onPlaybackFailure(state.lastTriedChannel, "The stream did not start in time.");
  }, 10000);
}

function clearPlaybackGuard() {
  if (state.playbackGuardTimer) {
    clearTimeout(state.playbackGuardTimer);
    state.playbackGuardTimer = null;
  }
}

function onVideoPlaying() {
  clearPlaybackGuard();
  hidePlaybackOverlay();
}

function onVideoElementError() {
  if (!state.lastTriedChannel) return;
  onPlaybackFailure(state.lastTriedChannel, "The browser reported a playback error.");
}

function onPlaybackFailure(channel, reason) {
  if (!state.hasSelectedChannel || !channel?.url || channel.url !== state.selectedUrl) {
    return;
  }

  clearPlaybackGuard();

  const name = channel?.display || channel?.name || "This channel";
  showPlaybackOverlay(channel?.url || "", `${name} failed to play. ${reason} Hide it from lists?`);
  setStatus("Playback failed. You can hide this channel from the overlay.", true);
}

function showPlaybackOverlay(channelUrl, message) {
  state.overlayChannelUrl = channelUrl;
  els.overlayMessage.textContent = message;
  els.playbackOverlay.hidden = false;
}

function hidePlaybackOverlay() {
  state.overlayChannelUrl = "";
  els.playbackOverlay.hidden = true;
}

function showPlayerPlaceholder(visible) {
  els.playerPlaceholder.hidden = !visible;
}

async function blacklistOverlayChannel() {
  const url = state.overlayChannelUrl;
  if (!url) {
    hidePlaybackOverlay();
    return;
  }

  try {
    await addToBlacklist(url);
    state.blacklistSet.add(url);
    updateBlacklistCount();
    renderHiddenChannelsList();

    if (state.favoritesMap.has(url)) {
      try {
        await deleteFavorite(url);
      } catch (err) {
        console.error(err);
      }
      setFavorites(state.favorites.filter((entry) => entry.url !== url));
    }

    if (state.selectedUrl === url) {
      teardownPlayers();
      state.selectedUrl = "";
      state.lastTriedChannel = null;
      state.hasSelectedChannel = false;
      els.channelName.textContent = "Select a channel";
      els.channelMeta.textContent = "Waiting for selection.";
      els.channelLogo.hidden = true;
      els.channelLogo.removeAttribute("src");
      showPlayerPlaceholder(true);
    }

    hidePlaybackOverlay();
    applyFilters();
    renderFavorites();
    updateVisibleFavoriteIcons();
    setStatus("Channel hidden from lists.");
  } catch (err) {
    console.error(err);
    setStatus("Could not hide this channel.", true);
  }
}

function playHls(channel) {
  const url = channel.url;

  if (window.Hls && window.Hls.isSupported()) {
    const hls = new window.Hls({ enableWorker: true });
    hls.loadSource(url);
    hls.attachMedia(els.video);
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      requestPlay();
      setStatus("Playing HLS stream.");
    });
    hls.on(window.Hls.Events.ERROR, (_, data) => {
      if (data?.fatal) {
        onPlaybackFailure(channel, "HLS stream error from source.");
      }
    });
    state.hls = hls;
    return;
  }

  if (els.video.canPlayType("application/vnd.apple.mpegurl")) {
    playNative(url);
    return;
  }

  onPlaybackFailure(channel, "HLS is not supported in this browser.");
}

function playDash(channel) {
  const url = channel.url;

  if (!window.dashjs) {
    onPlaybackFailure(channel, "DASH player library is unavailable.");
    return;
  }

  const player = window.dashjs.MediaPlayer().create();
  player.initialize(els.video, url, true);
  player.on(window.dashjs.MediaPlayer.events.ERROR, () => {
    onPlaybackFailure(channel, "DASH stream error from source.");
  });
  state.dash = player;
  setStatus("Playing DASH stream.");
}

function playNative(url) {
  els.video.src = url;
  requestPlay();
  setStatus("Attempting native playback.");
}

function requestPlay() {
  els.video.play().catch(() => {
    setStatus("Press play on the video element (autoplay blocked by browser).", true);
  });
}

function teardownPlayers() {
  clearPlaybackGuard();

  if (state.hls) {
    state.hls.destroy();
    state.hls = null;
  }

  if (state.dash) {
    state.dash.reset();
    state.dash = null;
  }

  els.video.pause();
  els.video.removeAttribute("src");
  els.video.load();
}

function typeForUrl(url) {
  const normalized = (url || "").toLowerCase().split("?")[0];
  if (normalized.endsWith(".m3u8")) return "hls";
  if (normalized.endsWith(".mpd")) return "dash";
  return "native";
}

function setStatus(msg, isWarn = false) {
  els.status.textContent = msg;
  els.status.classList.toggle("warn", isWarn);
}
