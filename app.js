const SIDEBAR_WIDTH_KEY = "iptv.sidebarWidth";
const INFER_LANGUAGE_KEY = "iptv.inferLanguage";
const GROUP_FILTER_KEY = "iptv.groupFilter";
const COUNTRY_FILTER_KEY = "iptv.countryFilter";
const FAVORITES_FILTER_KEY = "iptv.favoritesFilter";
const SIDEBAR_COLLAPSED_KEY = "iptv.sidebarCollapsed";
const FILTERS_COLLAPSED_KEY = "iptv.filtersCollapsed";
const CC_PREFERENCES_KEY = "iptv.ccPreferences";
const DEFAULT_SIDEBAR_WIDTH = 1000;

const COUNTRY_LANGUAGE_MAP = {
  ae: "Arabic",
  ar: "Spanish",
  at: "German",
  au: "English",
  be: "Dutch/French",
  bg: "Bulgarian",
  br: "Portuguese",
  ca: "English/French",
  ch: "German/French/Italian",
  cl: "Spanish",
  cn: "Chinese",
  co: "Spanish",
  cz: "Czech",
  de: "German",
  dk: "Danish",
  eg: "Arabic",
  es: "Spanish",
  fi: "Finnish",
  fr: "French",
  gb: "English",
  ge: "Georgian",
  gr: "Greek",
  hr: "Croatian",
  hu: "Hungarian",
  id: "Indonesian",
  ie: "English",
  il: "Hebrew",
  in: "Hindi",
  ir: "Persian",
  it: "Italian",
  jp: "Japanese",
  ke: "English/Swahili",
  kr: "Korean",
  mx: "Spanish",
  my: "Malay",
  ng: "English",
  nl: "Dutch",
  no: "Norwegian",
  nz: "English",
  pe: "Spanish",
  ph: "Filipino/English",
  pk: "Urdu",
  pl: "Polish",
  pt: "Portuguese",
  ro: "Romanian",
  rs: "Serbian",
  ru: "Russian",
  sa: "Arabic",
  se: "Swedish",
  sg: "English",
  th: "Thai",
  tr: "Turkish",
  tw: "Chinese",
  ua: "Ukrainian",
  uk: "English",
  us: "English",
  vn: "Vietnamese",
  za: "English",
};

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
  languageInferenceEnabled: false,
  persistedGroupFilter: "all",
  persistedCountryFilter: "all",
  persistedFavoritesFilter: "all",
  ccPreferences: [],
  ccApplyTimer: null,
  isSidebarCollapsed: false,
  isFiltersCollapsed: false,
};

const els = {
  playlistUrl: document.getElementById("playlistUrl"),
  loadBtn: document.getElementById("loadBtn"),
  status: document.getElementById("status"),
  searchInput: document.getElementById("searchInput"),
  groupSelect: document.getElementById("groupSelect"),
  countrySelect: document.getElementById("countrySelect"),
  favoritesFilter: document.getElementById("favoritesFilter"),
  languageSelect: document.getElementById("languageSelect"),
  languageFilterWrap: document.getElementById("languageFilterWrap"),
  inferLanguageToggle: document.getElementById("inferLanguageToggle"),
  channelList: document.getElementById("channelList"),
  filterCollapseBtn: document.getElementById("filterCollapseBtn"),
  sidebarCollapseBtn: document.getElementById("sidebarCollapseBtn"),
  sidebarExpandBtn: document.getElementById("sidebarExpandBtn"),
  exportSettingsBtn: document.getElementById("exportSettingsBtn"),
  importSettingsBtn: document.getElementById("importSettingsBtn"),
  importSettingsInput: document.getElementById("importSettingsInput"),
  ccPreferenceInput: document.getElementById("ccPreferenceInput"),
  addCcPreferenceBtn: document.getElementById("addCcPreferenceBtn"),
  ccPreferencesList: document.getElementById("ccPreferencesList"),
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
  els.groupSelect.addEventListener("change", onGroupFilterChange);
  els.countrySelect.addEventListener("change", onCountryFilterChange);
  els.favoritesFilter.addEventListener("change", onFavoritesFilterChange);
  els.languageSelect.addEventListener("change", applyFilters);
  els.inferLanguageToggle.addEventListener("change", onLanguageInferenceToggleChange);
  els.channelList.addEventListener("click", (event) => {
    void onChannelListClick(event);
  });
  els.channelList.addEventListener("scroll", maybeRenderMore);
  els.exportSettingsBtn.addEventListener("click", exportSettings);
  els.importSettingsBtn.addEventListener("click", () => {
    els.importSettingsInput.click();
  });
  els.importSettingsInput.addEventListener("change", (event) => {
    void importSettings(event);
  });
  els.addCcPreferenceBtn.addEventListener("click", addCcPreferenceFromInput);
  els.ccPreferenceInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    addCcPreferenceFromInput();
  });
  els.ccPreferencesList.addEventListener("click", onCcPreferencesListClick);
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
  els.video.addEventListener("loadedmetadata", () => {
    scheduleCaptionPreferenceApply();
  });
  els.filterCollapseBtn.addEventListener("click", () => {
    setFiltersCollapsed(!state.isFiltersCollapsed);
  });
  els.sidebarCollapseBtn.addEventListener("click", () => {
    setSidebarCollapsed(true);
  });
  els.sidebarExpandBtn.addEventListener("click", () => {
    setSidebarCollapsed(false);
  });

  initSplitter();
  initLanguageInferenceToggle();
  initPersistedFilters();
  initCcPreferences();
  initSidebarCollapse();
  window.addEventListener("resize", () => {
    els.splitHandle.hidden = state.isSidebarCollapsed || window.matchMedia("(max-width: 960px)").matches;
  });
  void bootstrap();
}

function initPersistedFilters() {
  const savedGroup = (window.localStorage.getItem(GROUP_FILTER_KEY) || "").trim();
  const savedCountry = (window.localStorage.getItem(COUNTRY_FILTER_KEY) || "").trim();
  const savedFavorites = (window.localStorage.getItem(FAVORITES_FILTER_KEY) || "").trim();

  state.persistedGroupFilter = savedGroup || "all";
  state.persistedCountryFilter = savedCountry || "all";
  state.persistedFavoritesFilter = savedFavorites === "favorites" ? "favorites" : "all";
  els.favoritesFilter.value = state.persistedFavoritesFilter;
}

function initCcPreferences() {
  const saved = window.localStorage.getItem(CC_PREFERENCES_KEY);
  if (!saved) {
    state.ccPreferences = [];
    renderCcPreferences();
    return;
  }

  try {
    state.ccPreferences = normalizeCcPreferences(JSON.parse(saved));
  } catch {
    state.ccPreferences = [];
  }

  renderCcPreferences();
}

function normalizeCcPreference(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/\s+/g, " ");
}

function normalizeCcPreferences(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const out = [];
  const seen = new Set();

  for (const raw of values) {
    const normalized = normalizeCcPreference(raw);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    out.push(normalized);
  }

  return out;
}

function persistCcPreferences() {
  window.localStorage.setItem(CC_PREFERENCES_KEY, JSON.stringify(state.ccPreferences));
}

function addCcPreferenceFromInput() {
  const value = normalizeCcPreference(els.ccPreferenceInput.value);
  if (!value) {
    return;
  }

  const exists = state.ccPreferences.some((entry) => entry.toLowerCase() === value.toLowerCase());
  if (!exists) {
    state.ccPreferences.push(value);
    persistCcPreferences();
    renderCcPreferences();
    scheduleCaptionPreferenceApply();
  }

  els.ccPreferenceInput.value = "";
}

function onCcPreferencesListClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const index = Number(button.dataset.index);
  if (!Number.isInteger(index) || index < 0 || index >= state.ccPreferences.length) {
    return;
  }

  const action = button.dataset.action;
  if (action === "delete") {
    state.ccPreferences.splice(index, 1);
  } else if (action === "up" && index > 0) {
    const prev = state.ccPreferences[index - 1];
    state.ccPreferences[index - 1] = state.ccPreferences[index];
    state.ccPreferences[index] = prev;
  } else if (action === "down" && index < state.ccPreferences.length - 1) {
    const next = state.ccPreferences[index + 1];
    state.ccPreferences[index + 1] = state.ccPreferences[index];
    state.ccPreferences[index] = next;
  } else {
    return;
  }

  persistCcPreferences();
  renderCcPreferences();
  scheduleCaptionPreferenceApply();
}

function renderCcPreferences() {
  els.ccPreferencesList.innerHTML = "";

  if (!state.ccPreferences.length) {
    const li = document.createElement("li");
    li.className = "cc-preference-empty";
    li.textContent = "No preferences set.";
    els.ccPreferencesList.appendChild(li);
    return;
  }

  const frag = document.createDocumentFragment();

  for (let idx = 0; idx < state.ccPreferences.length; idx += 1) {
    const entry = state.ccPreferences[idx];
    const li = document.createElement("li");
    li.className = "cc-preference-item";

    const label = document.createElement("span");
    label.className = "cc-preference-label";
    label.textContent = `${idx + 1}. ${entry}`;

    const actions = document.createElement("div");
    actions.className = "cc-preference-actions";

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "favorites-action-btn cc-preference-action-btn";
    upBtn.textContent = "↑";
    upBtn.dataset.action = "up";
    upBtn.dataset.index = String(idx);
    upBtn.disabled = idx === 0;
    upBtn.setAttribute("aria-label", `Move ${entry} up`);

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "favorites-action-btn cc-preference-action-btn";
    downBtn.textContent = "↓";
    downBtn.dataset.action = "down";
    downBtn.dataset.index = String(idx);
    downBtn.disabled = idx === state.ccPreferences.length - 1;
    downBtn.setAttribute("aria-label", `Move ${entry} down`);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "favorites-action-btn cc-preference-action-btn";
    removeBtn.textContent = "×";
    removeBtn.dataset.action = "delete";
    removeBtn.dataset.index = String(idx);
    removeBtn.setAttribute("aria-label", `Delete ${entry}`);

    actions.appendChild(upBtn);
    actions.appendChild(downBtn);
    actions.appendChild(removeBtn);

    li.appendChild(label);
    li.appendChild(actions);
    frag.appendChild(li);
  }

  els.ccPreferencesList.appendChild(frag);
}

function onGroupFilterChange() {
  const next = (els.groupSelect.value || "all").trim() || "all";
  state.persistedGroupFilter = next;
  window.localStorage.setItem(GROUP_FILTER_KEY, next);
  applyFilters();
}

function onCountryFilterChange() {
  const next = (els.countrySelect.value || "all").trim() || "all";
  state.persistedCountryFilter = next;
  window.localStorage.setItem(COUNTRY_FILTER_KEY, next);
  applyFilters();
}

function onFavoritesFilterChange() {
  const next = els.favoritesFilter.value === "favorites" ? "favorites" : "all";
  state.persistedFavoritesFilter = next;
  window.localStorage.setItem(FAVORITES_FILTER_KEY, next);
  applyFilters();
}

function initLanguageInferenceToggle() {
  const saved = window.localStorage.getItem(INFER_LANGUAGE_KEY);
  state.languageInferenceEnabled = saved === "1";
  els.inferLanguageToggle.checked = state.languageInferenceEnabled;
}

function onLanguageInferenceToggleChange() {
  state.languageInferenceEnabled = Boolean(els.inferLanguageToggle.checked);
  window.localStorage.setItem(INFER_LANGUAGE_KEY, state.languageInferenceEnabled ? "1" : "0");
  populateLanguages(state.channels, els.languageSelect.value);
  applyFilters();
}

function parseBooleanQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  if (!params.has(name)) {
    return null;
  }

  const raw = (params.get(name) || "").trim().toLowerCase();
  if (["1", "true", "yes", "on", "collapsed"].includes(raw)) {
    return true;
  }

  if (["0", "false", "no", "off", "expanded"].includes(raw)) {
    return false;
  }

  return null;
}

function initSidebarCollapse() {
  const savedSidebar = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  const savedFilters = window.localStorage.getItem(FILTERS_COLLAPSED_KEY) === "1";

  const querySidebar = parseBooleanQueryParam("sidebarCollapsed");
  const queryFilters = parseBooleanQueryParam("filtersCollapsed");

  setSidebarCollapsed(querySidebar === null ? savedSidebar : querySidebar);
  setFiltersCollapsed(queryFilters === null ? savedFilters : queryFilters);
}

function filterIconMarkup(isCollapsed) {
  if (isCollapsed) {
    // Outline funnel when filters are hidden.
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 5h18l-7 8v6l-4-2v-4L3 5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  }

  // Filled funnel when filters are visible.
  return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 5h18l-7 8v6l-4-2v-4L3 5z" fill="currentColor"/></svg>';
}

function setSidebarCollapsed(collapsed) {
  state.isSidebarCollapsed = Boolean(collapsed);
  els.sidebar.classList.toggle("is-collapsed", state.isSidebarCollapsed);
  els.sidebarExpandBtn.hidden = !state.isSidebarCollapsed;
  els.sidebarCollapseBtn.setAttribute("aria-expanded", state.isSidebarCollapsed ? "false" : "true");
  els.splitHandle.hidden = state.isSidebarCollapsed || window.matchMedia("(max-width: 960px)").matches;
  window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, state.isSidebarCollapsed ? "1" : "0");
}

function setFiltersCollapsed(collapsed) {
  state.isFiltersCollapsed = Boolean(collapsed);
  els.sidebar.classList.toggle("filters-collapsed", state.isFiltersCollapsed);
  els.filterCollapseBtn.innerHTML = filterIconMarkup(state.isFiltersCollapsed);
  els.filterCollapseBtn.setAttribute("aria-expanded", state.isFiltersCollapsed ? "false" : "true");
  els.filterCollapseBtn.setAttribute("aria-label", state.isFiltersCollapsed ? "Expand filters" : "Collapse filters");
  window.localStorage.setItem(FILTERS_COLLAPSED_KEY, state.isFiltersCollapsed ? "1" : "0");
}

async function bootstrap() {
  await Promise.all([loadFavorites(), loadBlacklist()]);
  await loadPlaylist();
}

function initSplitter() {
  const savedWidth = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
  if (savedWidth) {
    applySidebarWidth(savedWidth);
  } else {
    applySidebarWidth(DEFAULT_SIDEBAR_WIDTH);
  }

  els.splitHandle.addEventListener("pointerdown", (event) => {
    if (window.matchMedia("(max-width: 960px)").matches || state.isSidebarCollapsed) {
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
    const { minWidth, maxWidth } = getSidebarWidthBounds(layoutRect.width);
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
  const layoutRect = document.querySelector(".layout").getBoundingClientRect();
  const { minWidth, maxWidth } = getSidebarWidthBounds(layoutRect.width);
  const width = Math.round(clamp(widthPx, minWidth, maxWidth));
  els.sidebar.style.width = `${width}px`;
  els.sidebar.style.flexBasis = `${width}px`;
}

function getSidebarWidthBounds(layoutWidth) {
  const minWidth = 260;
  const maxWidth = Math.max(minWidth, Math.min(window.innerWidth * 0.68, layoutWidth - 280));
  return { minWidth, maxWidth };
}

function getBookmarkedChannelUrl() {
  const params = new URLSearchParams(window.location.search);
  const channel = (params.get("channel") || "").trim();
  return channel;
}

function getBookmarkedChannelId() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("channelId") || "").trim();
}

function getBookmarkedChannelName() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("channelName") || "").trim();
}

function setBookmarkedChannelUrl(channelUrl, channelId = "", channelName = "") {
  const url = new URL(window.location.href);
  if (channelUrl) {
    url.searchParams.set("channel", channelUrl);
    if (channelId) {
      url.searchParams.set("channelId", channelId);
    } else {
      url.searchParams.delete("channelId");
    }

    if (channelName) {
      url.searchParams.set("channelName", channelName);
    } else {
      url.searchParams.delete("channelName");
    }
  } else {
    url.searchParams.delete("channel");
    url.searchParams.delete("channelId");
    url.searchParams.delete("channelName");
  }

  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(null, "", nextUrl);
}

function normalizedText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeStreamUrl(raw, { includeQuery = true } = {}) {
  const value = String(raw || "").trim();
  if (!value) return "";

  try {
    const parsed = new URL(value);
    parsed.hash = "";
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    const query = includeQuery ? parsed.search : "";
    return `${parsed.origin}${path}${query}`;
  } catch {
    const noHash = value.split("#")[0] || "";
    const base = includeQuery ? noHash : (noHash.split("?")[0] || "");
    return base.replace(/\/+$/, "");
  }
}

function findChannelByLooseUrl(url) {
  const fullTarget = normalizeStreamUrl(url, { includeQuery: true });
  const pathTarget = normalizeStreamUrl(url, { includeQuery: false });

  if (!fullTarget && !pathTarget) {
    return null;
  }

  for (const channel of state.channels) {
    if (normalizeStreamUrl(channel.url, { includeQuery: true }) === fullTarget) {
      return channel;
    }
  }

  for (const channel of state.channels) {
    if (normalizeStreamUrl(channel.url, { includeQuery: false }) === pathTarget) {
      return channel;
    }
  }

  return null;
}

function findChannelById(id) {
  const target = normalizedText(id);
  if (!target) {
    return null;
  }

  return state.channels.find((channel) => normalizedText(channel.id) === target) || null;
}

function findChannelByName(name) {
  const target = normalizedText(name);
  if (!target) {
    return null;
  }

  return (
    state.channels.find(
      (channel) =>
        normalizedText(channel.display) === target ||
        normalizedText(channel.name) === target,
    ) || null
  );
}

function applyBookmarkedChannelSelection() {
  const bookmarkedUrl = getBookmarkedChannelUrl();
  const bookmarkedId = getBookmarkedChannelId();
  const bookmarkedName = getBookmarkedChannelName();

  if (!bookmarkedUrl && !bookmarkedId && !bookmarkedName) {
    return;
  }

  if (bookmarkedUrl && state.selectedUrl === bookmarkedUrl && state.hasSelectedChannel) {
    return;
  }

  let channel = null;

  if (bookmarkedUrl) {
    channel = findChannelByUrl(bookmarkedUrl) || state.favoritesMap.get(bookmarkedUrl) || findChannelByLooseUrl(bookmarkedUrl);
  }

  if (!channel && bookmarkedId) {
    channel = findChannelById(bookmarkedId);
  }

  if (!channel && bookmarkedName) {
    channel = findChannelByName(bookmarkedName);
  }

  if (!channel) {
    setStatus("Bookmarked channel was not found in this playlist.", true);
    return;
  }

  if (state.blacklistSet.has(channel.url)) {
    setStatus("Bookmarked channel is hidden. Unhide it to play.", true);
    return;
  }

  playChannel(channel);
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
    const selectedGroup = state.persistedGroupFilter || els.groupSelect.value;
    const selectedCountry = state.persistedCountryFilter || els.countrySelect.value;
    const selectedFavorites = state.persistedFavoritesFilter === "favorites" ? "favorites" : "all";
    const selectedLanguage = els.languageSelect.value;
    const normalizedChannels = channels.map((channel) => ({
      ...channel,
      language: normalizeLanguage(channel.language),
      country: normalizeCountry(channel.country || inferCountryFromTvgId(channel.id)),
      searchName: (channel.name || "").toLowerCase(),
      searchDisplay: (channel.display || "").toLowerCase(),
      streamType: typeForUrl(channel.url),
    }));

    if (!normalizedChannels.length) {
      setStatus("Loaded 0 channels. Check URL or playlist format.", true);
      return;
    }

    state.channels = normalizedChannels;
    populateGroups(normalizedChannels, selectedGroup);
    populateCountries(normalizedChannels, selectedCountry);
    state.persistedGroupFilter = els.groupSelect.value || "all";
    state.persistedCountryFilter = els.countrySelect.value || "all";
    state.persistedFavoritesFilter = selectedFavorites;
    window.localStorage.setItem(GROUP_FILTER_KEY, state.persistedGroupFilter);
    window.localStorage.setItem(COUNTRY_FILTER_KEY, state.persistedCountryFilter);
    window.localStorage.setItem(FAVORITES_FILTER_KEY, state.persistedFavoritesFilter);
    els.favoritesFilter.value = state.persistedFavoritesFilter;
    populateLanguages(normalizedChannels, selectedLanguage);
    applyFilters();
    renderFavorites();
    renderHiddenChannelsList();

    const elapsedMs = Math.round(performance.now() - startedAt);
    setStatus(`Loaded ${normalizedChannels.length} channels in ${elapsedMs}ms.`);
    applyBookmarkedChannelSelection();
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
  const separatorIndex = findFirstUnquotedComma(line);
  const afterComma = separatorIndex >= 0 ? line.slice(separatorIndex + 1).trim() : "Unknown";

  const tvgName = attr(line, "tvg-name") || afterComma;
  const tvgLogo = attr(line, "tvg-logo") || "";
  const groupTitle = attr(line, "group-title") || "Other";
  const language = attr(line, "tvg-language") || attr(line, "language") || "";
  const country = attr(line, "tvg-country") || "";
  const tvgId = attr(line, "tvg-id") || "";

  return {
    name: tvgName,
    logo: tvgLogo,
    group: groupTitle,
    language,
    country,
    id: tvgId,
    display: afterComma || tvgName,
  };
}

function inferCountryFromTvgId(tvgId) {
  if (typeof tvgId !== "string" || !tvgId) {
    return "";
  }

  const compactId = tvgId.trim();
  if (!compactId) {
    return "";
  }

  const beforeAt = compactId.split("@")[0] || "";
  if (!beforeAt.includes(".")) {
    return "";
  }

  const suffix = beforeAt.slice(beforeAt.lastIndexOf(".") + 1).toLowerCase();
  if (!suffix || suffix.length < 2 || suffix.length > 3 || /[^a-z]/.test(suffix)) {
    return "";
  }

  return suffix.toUpperCase();
}

function normalizeCountry(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toUpperCase();
}

function findFirstUnquotedComma(text) {
  let quoteChar = "";

  for (let idx = 0; idx < text.length; idx += 1) {
    const ch = text[idx];

    if (quoteChar) {
      if (ch === quoteChar) {
        quoteChar = "";
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quoteChar = ch;
      continue;
    }

    if (ch === ",") {
      return idx;
    }
  }

  return -1;
}

function normalizeLanguage(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/\s+/g, " ");
}

function attr(line, key) {
  const match = line.match(new RegExp(`${key}="([^"]*)"`));
  return match ? match[1] : "";
}

function populateGroups(channels, preferredSelection) {
  const groups = [...new Set(channels.map((c) => c.group).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  const selected = preferredSelection || els.groupSelect.value;

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

  els.groupSelect.value = groups.includes(selected) ? selected : "all";
}

function populateCountries(channels, preferredSelection) {
  const countries = [...new Set(channels.map((c) => c.country).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  const selected = preferredSelection || els.countrySelect.value;

  els.countrySelect.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All Countries";
  els.countrySelect.appendChild(allOption);

  const unknownOption = document.createElement("option");
  unknownOption.value = "__unknown";
  unknownOption.textContent = "Unknown Country";
  els.countrySelect.appendChild(unknownOption);

  for (const country of countries) {
    const opt = document.createElement("option");
    opt.value = country;
    opt.textContent = country;
    els.countrySelect.appendChild(opt);
  }

  if (selected === "all" || selected === "__unknown" || countries.includes(selected)) {
    els.countrySelect.value = selected;
  } else {
    els.countrySelect.value = "all";
  }
}

function populateLanguages(channels, preferredSelection) {
  const languages = [...new Set(channels.map((c) => effectiveLanguageForChannel(c)).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  );
  const selected = preferredSelection || els.languageSelect.value;
  const hasExplicitLanguages = channels.some((channel) => Boolean(channel.language));

  els.languageFilterWrap.hidden = !state.languageInferenceEnabled && !hasExplicitLanguages;

  els.languageSelect.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All Languages";
  els.languageSelect.appendChild(allOption);

  const unknownOption = document.createElement("option");
  unknownOption.value = "__unknown";
  unknownOption.textContent = "Unknown Language";
  els.languageSelect.appendChild(unknownOption);

  for (const language of languages) {
    const opt = document.createElement("option");
    opt.value = language;
    opt.textContent = language;
    els.languageSelect.appendChild(opt);
  }

  if (selected === "all" || selected === "__unknown" || languages.includes(selected)) {
    els.languageSelect.value = selected;
  } else {
    els.languageSelect.value = "all";
  }
}

function effectiveLanguageForChannel(channel) {
  const explicitLanguage = normalizeLanguage(channel?.language);
  if (explicitLanguage) {
    return explicitLanguage;
  }

  if (!state.languageInferenceEnabled) {
    return "";
  }

  const inferred = inferLanguageFromChannel(channel);
  return normalizeLanguage(inferred);
}

function inferLanguageFromChannel(channel) {
  const country = (channel?.country || "").toLowerCase();
  if (country && COUNTRY_LANGUAGE_MAP[country]) {
    return COUNTRY_LANGUAGE_MAP[country];
  }

  const display = String(channel?.display || channel?.name || "");
  if (/\p{Script=Cyrillic}/u.test(display)) {
    return "Cyrillic-script";
  }
  if (/\p{Script=Arabic}/u.test(display)) {
    return "Arabic-script";
  }
  if (/\p{Script=Hebrew}/u.test(display)) {
    return "Hebrew-script";
  }
  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(display)) {
    return "CJK-script";
  }

  return "";
}

function applyFilters() {
  const search = els.searchInput.value.trim().toLowerCase();
  const group = els.groupSelect.value;
  const country = els.countrySelect.value;
  const favoritesFilter = els.favoritesFilter.value;
  const language = els.languageSelect.value;
  const filtered = [];

  for (const channel of state.channels) {
    if (state.blacklistSet.has(channel.url)) {
      continue;
    }

    const matchesSearch =
      !search || channel.searchName.includes(search) || channel.searchDisplay.includes(search);
    const matchesGroup = group === "all" || channel.group === group;
    const matchesCountry =
      country === "all" ? true : country === "__unknown" ? !channel.country : channel.country === country;
    const matchesFavorite = favoritesFilter !== "favorites" || state.favoritesMap.has(channel.url);
    const channelLanguage = effectiveLanguageForChannel(channel);
    const matchesLanguage =
      language === "all"
        ? true
        : language === "__unknown"
          ? !channelLanguage
          : channelLanguage === language;

    if (matchesSearch && matchesGroup && matchesCountry && matchesFavorite && matchesLanguage) {
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
  setBookmarkedChannelUrl(channel.url, channel.id || "", channel.display || channel.name || "");
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
  updateVisibleFavoriteIcons();

  if (els.favoritesFilter.value === "favorites") {
    applyFilters();
  }
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
      searchTerm: (els.searchInput.value || "").trim(),
      groupFilter: els.groupSelect.value || "all",
      countryFilter: els.countrySelect.value || "all",
      favoritesFilter: els.favoritesFilter.value || "all",
      languageFilter: els.languageSelect.value || "all",
      inferLanguageEnabled: state.languageInferenceEnabled,
      ccPreferences: state.ccPreferences,
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

    if (typeof rawSettings?.searchTerm === "string") {
      els.searchInput.value = rawSettings.searchTerm;
    }

    if (typeof rawSettings?.groupFilter === "string") {
      els.groupSelect.value = rawSettings.groupFilter;
      if (els.groupSelect.value !== rawSettings.groupFilter) {
        els.groupSelect.value = "all";
      }
      state.persistedGroupFilter = els.groupSelect.value || "all";
      window.localStorage.setItem(GROUP_FILTER_KEY, state.persistedGroupFilter);
    }

    if (typeof rawSettings?.countryFilter === "string") {
      els.countrySelect.value = rawSettings.countryFilter;
      if (els.countrySelect.value !== rawSettings.countryFilter) {
        els.countrySelect.value = "all";
      }
      state.persistedCountryFilter = els.countrySelect.value || "all";
      window.localStorage.setItem(COUNTRY_FILTER_KEY, state.persistedCountryFilter);
    }

    if (typeof rawSettings?.favoritesFilter === "string") {
      els.favoritesFilter.value = rawSettings.favoritesFilter === "favorites" ? "favorites" : "all";
      state.persistedFavoritesFilter = els.favoritesFilter.value;
      window.localStorage.setItem(FAVORITES_FILTER_KEY, state.persistedFavoritesFilter);
    }

    if (typeof rawSettings?.languageFilter === "string") {
      els.languageSelect.value = rawSettings.languageFilter;
      if (els.languageSelect.value !== rawSettings.languageFilter) {
        els.languageSelect.value = "all";
      }
    }

    if (typeof rawSettings?.inferLanguageEnabled === "boolean") {
      state.languageInferenceEnabled = rawSettings.inferLanguageEnabled;
      els.inferLanguageToggle.checked = state.languageInferenceEnabled;
      window.localStorage.setItem(INFER_LANGUAGE_KEY, state.languageInferenceEnabled ? "1" : "0");
    }

    if (Array.isArray(rawSettings?.ccPreferences)) {
      state.ccPreferences = normalizeCcPreferences(rawSettings.ccPreferences);
      persistCcPreferences();
      renderCcPreferences();
      scheduleCaptionPreferenceApply();
    }

    if (shouldReloadPlaylist) {
      await loadPlaylist();
    }

    if (state.selectedUrl && state.blacklistSet.has(state.selectedUrl)) {
      teardownPlayers();
      state.selectedUrl = "";
      state.lastTriedChannel = null;
      state.hasSelectedChannel = false;
      setBookmarkedChannelUrl("");
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

function scheduleCaptionPreferenceApply() {
  if (state.ccApplyTimer) {
    clearTimeout(state.ccApplyTimer);
    state.ccApplyTimer = null;
  }

  let attempts = 0;
  const maxAttempts = 10;

  const run = () => {
    const done = applyCaptionPreferenceOnce();
    attempts += 1;

    if (done || attempts >= maxAttempts) {
      state.ccApplyTimer = null;
      return;
    }

    state.ccApplyTimer = window.setTimeout(run, 700);
  };

  run();
}

function disableAllTextTracks() {
  const tracks = els.video.textTracks;
  if (!tracks || !tracks.length) {
    return;
  }

  for (let idx = 0; idx < tracks.length; idx += 1) {
    tracks[idx].mode = "disabled";
  }
}

function captionTrackText(track) {
  const label = normalizeCcPreference(track?.label);
  const language = normalizeCcPreference(track?.language);
  const kind = normalizeCcPreference(track?.kind);
  return `${label} ${language} ${kind}`.toLowerCase();
}

function trackMatchesPreference(track, preference) {
  const needle = normalizeCcPreference(preference).toLowerCase();
  if (!needle) {
    return false;
  }

  const label = normalizeCcPreference(track?.label).toLowerCase();
  const language = normalizeCcPreference(track?.language).toLowerCase();
  const full = captionTrackText(track);

  return label === needle || language === needle || full.includes(needle);
}

function applyCaptionPreferenceOnce() {
  if (!state.ccPreferences.length) {
    return true;
  }

  const tracks = els.video.textTracks;
  if (!tracks || !tracks.length) {
    return false;
  }

  for (const preference of state.ccPreferences) {
    for (let idx = 0; idx < tracks.length; idx += 1) {
      const track = tracks[idx];
      if (!trackMatchesPreference(track, preference)) {
        continue;
      }

      disableAllTextTracks();
      track.mode = "showing";
      return true;
    }
  }

  // Captions exist, but none match the configured preference list.
  return true;
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
      setBookmarkedChannelUrl("");
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
      scheduleCaptionPreferenceApply();
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
  scheduleCaptionPreferenceApply();
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
  scheduleCaptionPreferenceApply();
}

function requestPlay() {
  els.video.play().catch((err) => {
    if (err?.name === "NotAllowedError") {
      // This is not a stream failure; user interaction is required by browser policy.
      clearPlaybackGuard();
      setStatus("Press play on the video element (autoplay blocked by browser).", true);
      return;
    }

    setStatus("Playback could not start automatically.", true);
  });
}

function teardownPlayers() {
  clearPlaybackGuard();

  if (state.ccApplyTimer) {
    clearTimeout(state.ccApplyTimer);
    state.ccApplyTimer = null;
  }

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
