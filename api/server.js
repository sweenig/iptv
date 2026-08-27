const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const Database = require("better-sqlite3");

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || "/data";
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || "/recordings";
const FAVORITES_FILE = path.join(DATA_DIR, "favorites.json");
const BLACKLIST_FILE = path.join(DATA_DIR, "blacklist.json");
const DB_PATH = path.join(DATA_DIR, "recordings.db");

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

async function ensureDataFile(filePath, defaultJson = "[]\n") {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    await fsp.access(filePath);
  } catch {
    await fsp.writeFile(filePath, defaultJson, "utf8");
  }
}

async function readJsonArray(filePath) {
  await ensureDataFile(filePath);
  const raw = await fsp.readFile(filePath, "utf8");
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
  await fsp.writeFile(tempFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
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

async function initializeDatabase() {
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const db = new Database(DB_PATH);
    
    // Read and execute init script
    const initScriptPath = path.join(__dirname, "db", "init.sql");
    const initScript = await fsp.readFile(initScriptPath, "utf8");
    
    // Execute each statement in the init script
    const statements = initScript.split(";").filter((stmt) => stmt.trim());
    for (const statement of statements) {
      db.exec(statement);
    }
    
    db.close();
    console.log("Database initialized successfully at", DB_PATH);
  } catch (err) {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  }
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

    // Recordings endpoints - must come before the /favorites pathname check
    if (url.pathname.startsWith("/recordings")) {
      // POST /recordings/start - Create a new recording job
      if (req.method === "POST" && url.pathname === "/recordings/start") {
        const body = await parseBody(req);
        const channelUrl = typeof body?.channel_url === "string" ? body.channel_url.trim() : "";
        const channelName = typeof body?.channel_name === "string" ? body.channel_name.trim() : "";
        const durationMinutes = Number(body?.duration_minutes) || 0;

        if (!channelUrl || !channelName) {
          sendJson(res, 400, { error: "channel_url and channel_name are required" });
          return;
        }

        if (durationMinutes < 0.5 || durationMinutes > 240) {
          sendJson(res, 400, { error: "duration_minutes must be between 0.5 and 240 minutes (4 hours)" });
          return;
        }

        try {
          const db = new Database(DB_PATH);
          const recordingId = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          const now = new Date().toISOString();

          db.prepare(
            `INSERT INTO recordings_jobs 
             (id, channel_url, channel_name, duration_minutes, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).run(recordingId, channelUrl, channelName, durationMinutes, "pending", now);

          db.close();

          const estimatedEndTime = new Date(Date.now() + (durationMinutes + 7) * 60 * 1000).toISOString();

          sendJson(res, 201, {
            ok: true,
            recording_id: recordingId,
            channel_name: channelName,
            duration_minutes: durationMinutes,
            status: "pending",
            created_at: now,
            estimated_completion: estimatedEndTime,
          });
          return;
        } catch (err) {
          console.error("Error creating recording job:", err);
          sendJson(res, 500, { error: "Failed to create recording job" });
          return;
        }
      }

      // GET /recordings/list - List recordings for a channel or all recordings
      if (req.method === "GET" && url.pathname === "/recordings/list") {
        const channelName = (url.searchParams.get("channel_name") || "").trim();

        try {
          const db = new Database(DB_PATH);
          let recordings;

          if (channelName) {
            // Get recordings for specific channel
            recordings = db
              .prepare(
                `SELECT id, channel_name, duration_minutes, status, file_path, created_at, started_at, completed_at, error
                 FROM recordings_jobs 
                 WHERE channel_name = ? 
                 ORDER BY created_at DESC`
              )
              .all(channelName);
          } else {
            // Get all recordings
            recordings = db
              .prepare(
                `SELECT id, channel_name, duration_minutes, status, file_path, created_at, started_at, completed_at, error
                 FROM recordings_jobs 
                 ORDER BY created_at DESC`
              )
              .all();
          }

          db.close();

          sendJson(res, 200, { ok: true, channel_name: channelName || null, recordings });
          return;
        } catch (err) {
          console.error("Error fetching recordings:", err);
          sendJson(res, 500, { error: "Failed to fetch recordings" });
          return;
        }
      }

      // GET /recordings/status/:id - Get recording status
      if (req.method === "GET" && url.pathname.match(/^\/recordings\/status\//)) {
        const recordingId = url.pathname.split("/").pop();

        try {
          const db = new Database(DB_PATH);
          const job = db
            .prepare(
              `SELECT id, channel_name, duration_minutes, status, recorder_id, file_path, error, created_at, started_at, completed_at, last_heartbeat
               FROM recordings_jobs 
               WHERE id = ?`
            )
            .get(recordingId);

          db.close();

          if (!job) {
            sendJson(res, 404, { error: "Recording not found" });
            return;
          }

          sendJson(res, 200, { ok: true, recording: job });
          return;
        } catch (err) {
          console.error("Error fetching recording status:", err);
          sendJson(res, 500, { error: "Failed to fetch recording status" });
          return;
        }
      }

      // DELETE /recordings/:id - Delete a recording
      if (req.method === "DELETE" && url.pathname.match(/^\/recordings\/[^/]+$/) && !url.pathname.includes("status")) {
        const recordingId = url.pathname.split("/").pop();

        try {
          const db = new Database(DB_PATH);
          const job = db.prepare("SELECT file_path FROM recordings_jobs WHERE id = ?").get(recordingId);

          if (!job) {
            db.close();
            sendJson(res, 404, { error: "Recording not found" });
            return;
          }

          // Delete the recording record
          db.prepare("DELETE FROM recordings_jobs WHERE id = ?").run(recordingId);
          db.close();

          // Try to delete the file asynchronously
          if (job.file_path) {
            const RECORDINGS_DIR = process.env.RECORDINGS_DIR || "/recordings";
            const filePath = path.join(RECORDINGS_DIR, job.file_path);
            fs.unlink(filePath).catch((err) => {
              if (err.code !== "ENOENT") {
                console.warn("Warning: Could not delete recording file:", err);
              }
            });
          }

          sendJson(res, 200, { ok: true, message: "Recording deleted" });
          return;
        } catch (err) {
          console.error("Error deleting recording:", err);
          sendJson(res, 500, { error: "Failed to delete recording" });
          return;
        }
      }

      // PUT /recordings/:id/cancel - Cancel a recording
      if (req.method === "PUT" && url.pathname.match(/^\/recordings\/[^/]+\/cancel$/)) {
        const recordingId = url.pathname.split("/")[2];
        const body = await parseBody(req);
        const deleteFile = body?.delete_file === true;

        try {
          const db = new Database(DB_PATH);
          const job = db.prepare("SELECT status, file_path FROM recordings_jobs WHERE id = ?").get(recordingId);

          if (!job) {
            db.close();
            sendJson(res, 404, { error: "Recording not found" });
            return;
          }

          if (job.status !== "recording" && job.status !== "pending") {
            db.close();
            sendJson(res, 400, { error: "Can only cancel in-progress or pending recordings" });
            return;
          }

          // Mark as failed with cancellation message
          db.prepare("UPDATE recordings_jobs SET status = ?, error = ? WHERE id = ?").run(
            "failed",
            "Recording cancelled by user",
            recordingId
          );
          db.close();

          // Delete file if requested
          if (deleteFile && job.file_path) {
            const RECORDINGS_DIR = process.env.RECORDINGS_DIR || "/recordings";
            const filePath = path.join(RECORDINGS_DIR, job.file_path);
            fs.unlink(filePath).catch((err) => {
              if (err.code !== "ENOENT") {
                console.warn("Warning: Could not delete recording file:", err);
              }
            });
          }

          sendJson(res, 200, { ok: true, message: "Recording cancelled" });
          return;
        } catch (err) {
          console.error("Error cancelling recording:", err);
          sendJson(res, 500, { error: "Failed to cancel recording" });
          return;
        }
      }

      // PUT /recordings/:id/rename - Rename a completed recording
      if (req.method === "PUT" && url.pathname.match(/^\/recordings\/[^/]+\/rename$/)) {
        const recordingId = url.pathname.split("/")[2];
        const body = await parseBody(req);
        const newName = typeof body?.name === "string" ? body.name.trim() : "";

        if (!newName) {
          sendJson(res, 400, { error: "name is required" });
          return;
        }

        try {
          const db = new Database(DB_PATH);
          const job = db.prepare("SELECT status, file_path FROM recordings_jobs WHERE id = ?").get(recordingId);

          if (!job) {
            db.close();
            sendJson(res, 404, { error: "Recording not found" });
            return;
          }

          if (job.status !== "complete") {
            db.close();
            sendJson(res, 400, { error: "Can only rename completed recordings" });
            return;
          }

          if (!job.file_path) {
            db.close();
            sendJson(res, 400, { error: "Recording has no file path" });
            return;
          }

          // Rename the file
          const RECORDINGS_DIR = process.env.RECORDINGS_DIR || "/recordings";
          const oldPath = path.join(RECORDINGS_DIR, job.file_path);
          const dirName = path.dirname(oldPath);
          const ext = path.extname(job.file_path);
          const newFileName = `${newName}${ext}`;
          const newFilePath = path.join(dirName, newFileName);
          const relativeNewPath = path.relative(RECORDINGS_DIR, newFilePath);

          fs.rename(oldPath, newFilePath)
            .then(() => {
              // Update database with new file path
              const updateDb = new Database(DB_PATH);
              updateDb.prepare("UPDATE recordings_jobs SET file_path = ? WHERE id = ?").run(relativeNewPath, recordingId);
              updateDb.close();
            })
            .catch((err) => {
              console.error("Error renaming recording file:", err);
            });

          sendJson(res, 200, { ok: true, message: "Recording renamed" });
          return;
        } catch (err) {
          console.error("Error renaming recording:", err);
          sendJson(res, 500, { error: "Failed to rename recording" });
          return;
        }
      }

      // GET /recordings/file/:id - Serve recording file
      if (req.method === "GET" && url.pathname.match(/^\/recordings\/file\/[^/]+$/)) {
        const recordingId = url.pathname.split("/").pop();

        try {
          const db = new Database(DB_PATH);
          const job = db.prepare("SELECT file_path, channel_name FROM recordings_jobs WHERE id = ?").get(recordingId);
          db.close();

          if (!job || !job.file_path) {
            sendJson(res, 404, { error: "Recording not found" });
            return;
          }

          const filePath = path.join(RECORDINGS_DIR, job.file_path);

          // Check if file exists
          fsp
            .stat(filePath)
            .then(() => {
              // Stream the file
              res.setHeader("Content-Type", "video/mp4");
              res.setHeader("Cache-Control", "public, max-age=3600");
              res.setHeader(
                "Content-Disposition",
                `inline; filename="${path.basename(filePath)}"`
              );

              const fileStream = fs.createReadStream(filePath);
              fileStream.pipe(res);

              fileStream.on("error", (err) => {
                console.error("Error streaming file:", err);
                if (!res.headersSent) {
                  res.statusCode = 500;
                  res.end("Error streaming file");
                }
              });
            })
            .catch(() => {
              sendJson(res, 404, { error: "Recording file not found on disk" });
            });
          return;
        } catch (err) {
          console.error("Error serving recording file:", err);
          sendJson(res, 500, { error: "Failed to serve recording" });
          return;
        }
      }

      sendJson(res, 404, { error: "Not found" });
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

(async () => {
  await initializeDatabase();
  server.listen(PORT, () => {
    console.log(`data-api listening on :${PORT}`);
  });
})();
