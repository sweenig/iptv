const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || "/data";
const FAVORITES_FILE = path.join(DATA_DIR, "favorites.json");
const BLACKLIST_FILE = path.join(DATA_DIR, "blacklist.json");

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

async function ensureDataFile(filePath, defaultJson = "[]\n") {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, defaultJson, "utf8");
  }
}

async function readJsonArray(filePath) {
  await ensureDataFile(filePath);
  const raw = await fs.readFile(filePath, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeJsonArray(filePath, data) {
  await ensureDataFile(filePath);
  const tempFile = `${filePath}.tmp`;
  await fs.writeFile(tempFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(tempFile, filePath);
}

async function readFavorites() {
  return readJsonArray(FAVORITES_FILE);
}

async function writeFavorites(favorites) {
  return writeJsonArray(FAVORITES_FILE, favorites);
}

async function readBlacklist() {
  return readJsonArray(BLACKLIST_FILE);
}

async function writeBlacklist(blacklist) {
  return writeJsonArray(BLACKLIST_FILE, blacklist);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) {
        reject(new Error("Payload too large"));
      }
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function normalizeFavorite(input) {
  const url = typeof input.url === "string" ? input.url.trim() : "";
  if (!url) {
    return null;
  }

  return {
    url,
    name: typeof input.name === "string" ? input.name : "",
    display: typeof input.display === "string" ? input.display : "",
    group: typeof input.group === "string" ? input.group : "Other",
    logo: typeof input.logo === "string" ? input.logo : "",
    id: typeof input.id === "string" ? input.id : "",
    streamType: typeof input.streamType === "string" ? input.streamType : "native",
    updatedAt: new Date().toISOString(),
  };
}

function normalizeFavoritesList(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set();
  const favorites = [];

  for (const raw of input) {
    const favorite = normalizeFavorite(raw || {});
    if (!favorite || seen.has(favorite.url)) {
      continue;
    }

    seen.add(favorite.url);
    favorites.push(favorite);
  }

  return favorites;
}

function normalizeStringList(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set();
  const out = [];

  for (const raw of input) {
    if (typeof raw !== "string") {
      continue;
    }

    const value = raw.trim();
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    out.push(value);
  }

  return out;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok\n");
      return;
    }

    if (req.method === "PUT" && url.pathname === "/blacklist/bulk") {
      const body = await parseBody(req);
      const channels = normalizeStringList(body?.channels);
      await writeBlacklist(channels);
      sendJson(res, 200, { ok: true, count: channels.length, channels });
      return;
    }

    if (url.pathname === "/blacklist") {
      if (req.method === "GET") {
        const channels = await readBlacklist();
        sendJson(res, 200, { channels });
        return;
      }

      if (req.method === "PUT") {
        const body = await parseBody(req);
        const channelUrl = typeof body?.url === "string" ? body.url.trim() : "";

        if (!channelUrl) {
          sendJson(res, 400, { error: "url is required" });
          return;
        }

        const channels = await readBlacklist();
        const next = channels.includes(channelUrl) ? channels : [...channels, channelUrl];
        await writeBlacklist(next);
        sendJson(res, 200, { ok: true, count: next.length, channels: next });
        return;
      }

      if (req.method === "DELETE") {
        const targetUrl = (url.searchParams.get("url") || "").trim();

        if (!targetUrl) {
          await writeBlacklist([]);
          sendJson(res, 200, { ok: true, count: 0, channels: [] });
          return;
        }

        const channels = await readBlacklist();
        const next = channels.filter((entry) => entry !== targetUrl);
        await writeBlacklist(next);
        sendJson(res, 200, { ok: true, count: next.length, channels: next });
        return;
      }

      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    if (req.method === "PUT" && url.pathname === "/favorites/bulk") {
      const body = await parseBody(req);
      const incoming = normalizeFavoritesList(body?.favorites);
      const mode = body?.mode === "merge" ? "merge" : "replace";

      if (!incoming.length && mode === "merge") {
        sendJson(res, 400, { error: "favorites array is required" });
        return;
      }

      let next = incoming;
      if (mode === "merge") {
        const existing = await readFavorites();
        const map = new Map(existing.map((entry) => [entry.url, entry]));
        for (const favorite of incoming) {
          map.set(favorite.url, { ...(map.get(favorite.url) || {}), ...favorite });
        }

        next = [];
        const seen = new Set();

        for (const entry of existing) {
          if (map.has(entry.url) && !seen.has(entry.url)) {
            next.push(map.get(entry.url));
            seen.add(entry.url);
          }
        }

        for (const favorite of incoming) {
          if (!seen.has(favorite.url)) {
            next.push(favorite);
            seen.add(favorite.url);
          }
        }
      }

      await writeFavorites(next);
      sendJson(res, 200, { ok: true, count: next.length, favorites: next });
      return;
    }

    if (req.method === "PUT" && url.pathname === "/favorites/order") {
      const body = await parseBody(req);
      const orderedUrls = Array.isArray(body?.urls) ? body.urls.filter((entry) => typeof entry === "string") : [];

      if (!orderedUrls.length) {
        sendJson(res, 400, { error: "urls array is required" });
        return;
      }

      const favorites = await readFavorites();
      const map = new Map(favorites.map((entry) => [entry.url, entry]));
      const next = [];
      const seen = new Set();

      for (const itemUrl of orderedUrls) {
        const normalizedUrl = itemUrl.trim();
        if (!normalizedUrl || !map.has(normalizedUrl) || seen.has(normalizedUrl)) {
          continue;
        }
        next.push(map.get(normalizedUrl));
        seen.add(normalizedUrl);
      }

      for (const entry of favorites) {
        if (!seen.has(entry.url)) {
          next.push(entry);
        }
      }

      await writeFavorites(next);
      sendJson(res, 200, { ok: true, count: next.length, favorites: next });
      return;
    }

    if (url.pathname !== "/favorites") {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    if (req.method === "GET") {
      const favorites = await readFavorites();
      sendJson(res, 200, { favorites });
      return;
    }

    if (req.method === "PUT") {
      const body = await parseBody(req);
      const favorite = normalizeFavorite(body);

      if (!favorite) {
        sendJson(res, 400, { error: "Favorite url is required" });
        return;
      }

      const favorites = await readFavorites();
      const existingIndex = favorites.findIndex((entry) => entry.url === favorite.url);

      if (existingIndex >= 0) {
        favorites[existingIndex] = { ...favorites[existingIndex], ...favorite };
      } else {
        favorites.push(favorite);
      }

      await writeFavorites(favorites);
      sendJson(res, 200, { ok: true, count: favorites.length });
      return;
    }

    if (req.method === "DELETE") {
      const targetUrl = (url.searchParams.get("url") || "").trim();
      if (!targetUrl) {
        sendJson(res, 400, { error: "url query parameter is required" });
        return;
      }

      const favorites = await readFavorites();
      const next = favorites.filter((entry) => entry.url !== targetUrl);
      await writeFavorites(next);
      sendJson(res, 200, { ok: true, count: next.length });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`favorites-api listening on :${PORT}`);
});
