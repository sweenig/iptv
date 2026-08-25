const state = {
  channels: [],
  filtered: [],
  selectedUrl: "",
  hls: null,
  dash: null,
  renderChunkSize: 140,
  renderedCount: 0,
  filterTimer: null,
};

const els = {
  playlistUrl: document.getElementById("playlistUrl"),
  loadBtn: document.getElementById("loadBtn"),
  status: document.getElementById("status"),
  searchInput: document.getElementById("searchInput"),
  groupSelect: document.getElementById("groupSelect"),
  channelList: document.getElementById("channelList"),
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
  els.channelList.addEventListener("click", onChannelListClick);
  els.channelList.addEventListener("scroll", maybeRenderMore);

  // Load the default playlist on startup.
  loadPlaylist();
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
    const elapsedMs = Math.round(performance.now() - startedAt);
    setStatus(`Loaded ${normalizedChannels.length} channels in ${elapsedMs}ms.`);
  } catch (err) {
    console.error(err);
    setStatus(
      "Could not load playlist. The source may block browser CORS requests.",
      true,
    );
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
      out.push({
        ...pendingMeta,
        url: line,
      });
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
    li.textContent = "No channels match your filters.";
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

    if (channel.url === state.selectedUrl) {
      li.classList.add("active");
    }

    const titleWrap = document.createElement("div");
    const title = document.createElement("div");
    title.className = "channel-title";
    title.textContent = channel.display || channel.name;

    const sub = document.createElement("div");
    sub.className = "channel-group";
    sub.textContent = channel.group || "Other";

    titleWrap.appendChild(title);
    titleWrap.appendChild(sub);

    const playTag = document.createElement("div");
    playTag.className = "channel-group";
    playTag.textContent = channel.streamType.toUpperCase();

    li.appendChild(titleWrap);
    li.appendChild(playTag);
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
  const item = event.target.closest(".channel-item");
  if (!item) return;

  const idx = Number(item.dataset.channelIndex);
  if (Number.isNaN(idx)) return;

  const channel = state.filtered[idx];
  if (!channel) return;

  playChannel(channel);
}

function playChannel(channel) {
  teardownPlayers();

  state.selectedUrl = channel.url;
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
  setStatus(`Connecting (${type})...`);

  try {
    if (type === "hls") {
      playHls(channel.url);
      return;
    }

    if (type === "dash") {
      playDash(channel.url);
      return;
    }

    playNative(channel.url);
  } catch (err) {
    console.error(err);
    setStatus("Playback failed. Browser may not support this stream.", true);
  }
}

function updateActiveChannel() {
  const items = els.channelList.querySelectorAll(".channel-item");
  items.forEach((item) => {
    const idx = Number(item.dataset.channelIndex);
    const channel = state.filtered[idx];
    const isActive = channel && channel.url === state.selectedUrl;
    item.classList.toggle("active", Boolean(isActive));
  });
}

function playHls(url) {
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
        setStatus("HLS error. Source may be blocked or unavailable.", true);
      }
    });
    state.hls = hls;
    return;
  }

  if (els.video.canPlayType("application/vnd.apple.mpegurl")) {
    playNative(url);
    return;
  }

  setStatus("HLS is not supported in this browser.", true);
}

function playDash(url) {
  if (!window.dashjs) {
    setStatus("DASH player library not available.", true);
    return;
  }

  const player = window.dashjs.MediaPlayer().create();
  player.initialize(els.video, url, true);
  state.dash = player;
  setStatus("Playing DASH stream.");
}

function playNative(url) {
  els.video.src = url;
  requestPlay();
  setStatus("Attempting native playback.");
}

function requestPlay() {
  els.video
    .play()
    .catch(() => setStatus("Press play on the video element (autoplay blocked by browser).", true));
}

function teardownPlayers() {
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
