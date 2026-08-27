const Database = require("better-sqlite3");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const DATA_DIR = process.env.DATA_DIR || "/data";
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || "/recordings";
const DB_PATH = path.join(DATA_DIR, "recordings.db");
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 3000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS || 30000);

// Generate unique recorder ID from hostname and a random suffix
const RECORDER_ID = `recorder-${process.env.HOSTNAME || "unknown"}`.slice(0, 50);

let db = null;
let running = true;
let pollInterval = null;
let currentJobId = null;
let currentFfmpegProcess = null;

// Sanitize channel name for use as directory name
function sanitizeChannelName(channelName) {
  return channelName
    .replace(/[\/\\]/g, "_") // Replace slashes with underscores
    .replace(/[^\w\s-]/g, "") // Remove special characters except spaces and hyphens
    .replace(/\s+/g, "_") // Replace spaces with underscores
    .replace(/_+/g, "_") // Collapse multiple underscores
    .slice(0, 100); // Limit length
}

async function openDatabase() {
  try {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    console.log(`[${RECORDER_ID}] Connected to database at ${DB_PATH}`);
  } catch (err) {
    console.error(`[${RECORDER_ID}] Failed to open database:`, err);
    process.exit(1);
  }
}

async function closeDatabase() {
  if (db) {
    try {
      db.close();
      console.log(`[${RECORDER_ID}] Database closed`);
    } catch (err) {
      console.error(`[${RECORDER_ID}] Error closing database:`, err);
    }
  }
}

async function ensureRecordingsDir() {
  try {
    await fs.mkdir(RECORDINGS_DIR, { recursive: true });
    console.log(`[${RECORDER_ID}] Recordings directory ready at ${RECORDINGS_DIR}`);
  } catch (err) {
    console.error(`[${RECORDER_ID}] Failed to create recordings directory:`, err);
    process.exit(1);
  }
}

async function tryLockJob() {
  if (!db) return null;

  try {
    // Begin transaction to atomically get and lock a pending job
    const acquireStmt = db.prepare(
      `SELECT id, channel_url, channel_name, duration_minutes 
       FROM recordings_jobs 
       WHERE status = 'pending' 
       LIMIT 1`
    );

    const lockStmt = db.prepare(
      `UPDATE recordings_jobs 
       SET status = 'recording', recorder_id = ?, started_at = ?, last_heartbeat = ?
       WHERE id = ? AND status = 'pending'`
    );

    const job = acquireStmt.get();
    if (!job) {
      return null; // No pending jobs
    }

    // Try to lock the job
    const now = new Date().toISOString();
    const result = lockStmt.run(RECORDER_ID, now, now, job.id);

    if (result.changes > 0) {
      console.log(`[${RECORDER_ID}] Locked job ${job.id} (${job.channel_name}, ${job.duration_minutes}min)`);
      return job;
    } else {
      // Another recorder already locked this job
      return null;
    }
  } catch (err) {
    console.error(`[${RECORDER_ID}] Error during job acquisition:`, err);
    return null;
  }
}

async function updateHeartbeat(jobId) {
  if (!db || !jobId) return;

  try {
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE recordings_jobs 
       SET last_heartbeat = ? 
       WHERE id = ?`
    ).run(now, jobId);
  } catch (err) {
    console.error(`[${RECORDER_ID}] Error updating heartbeat for ${jobId}:`, err);
  }
}

async function runFFmpeg(job) {
  return new Promise((resolve) => {
    try {
      // Ensure channel-specific directory exists
      const sanitizedChannelName = sanitizeChannelName(job.channel_name);
      const channelDir = path.join(RECORDINGS_DIR, sanitizedChannelName);
      fs.mkdir(channelDir, { recursive: true })
        .then(() => {
          // Create output filename with timestamp and duration
          const timestamp = Date.now();
          const filename = `recording-${timestamp}-${job.duration_minutes}m.mp4`;
          const outputPath = path.join(channelDir, filename);
          const filePathForDb = path.join(sanitizedChannelName, filename);

          console.log(
            `[${RECORDER_ID}] Starting FFmpeg for job ${job.id}: ${job.channel_url} -> ${outputPath}`
          );

          // Calculate total duration with 5-10 minute buffer
          const bufferMinutes = 7; // 7 minutes buffer
          const totalSeconds = (job.duration_minutes + bufferMinutes) * 60;

          // Spawn FFmpeg process
          currentFfmpegProcess = spawn("ffmpeg", [
            "-i",
            job.channel_url,
            "-c:v",
            "copy", // Don't re-encode video
            "-c:a",
            "copy", // Don't re-encode audio
            "-t",
            String(totalSeconds), // Duration limit
            "-f",
            "mp4",
            outputPath,
          ]);

          let errorOutput = "";

          currentFfmpegProcess.stderr.on("data", (data) => {
            errorOutput += data.toString();
          });

          currentFfmpegProcess.stdout.on("data", (data) => {
            // Ignore stdout
          });

          // Heartbeat timer
          const heartbeatTimer = setInterval(() => {
            updateHeartbeat(job.id);
          }, HEARTBEAT_INTERVAL_MS);

          currentFfmpegProcess.on("exit", (code) => {
            clearInterval(heartbeatTimer);
            currentFfmpegProcess = null;

            if (code === 0) {
              console.log(`[${RECORDER_ID}] FFmpeg completed successfully for job ${job.id}`);
              // Mark job as complete
              const now = new Date().toISOString();
              db.prepare(
                `UPDATE recordings_jobs 
                 SET status = 'complete', completed_at = ?, file_path = ?
                 WHERE id = ?`
              ).run(now, filePathForDb, job.id);
              resolve({ success: true });
            } else {
              const error = `FFmpeg exited with code ${code}`;
              console.error(`[${RECORDER_ID}] ${error} for job ${job.id}`);
              // Mark job as failed
              db.prepare(
                `UPDATE recordings_jobs 
                 SET status = 'failed', error = ?
                 WHERE id = ?`
              ).run(error, job.id);
              resolve({ success: false, error });
            }
          });

          currentFfmpegProcess.on("error", (err) => {
            clearInterval(heartbeatTimer);
            currentFfmpegProcess = null;
            const errorMsg = `FFmpeg spawn error: ${err.message}`;
            console.error(`[${RECORDER_ID}] ${errorMsg} for job ${job.id}`);
            // Mark job as failed
            db.prepare(
              `UPDATE recordings_jobs 
               SET status = 'failed', error = ?
               WHERE id = ?`
            ).run(errorMsg, job.id);
            resolve({ success: false, error: errorMsg });
          });
        })
        .catch((err) => {
          const errorMsg = `Failed to create channel directory: ${err.message}`;
          console.error(`[${RECORDER_ID}] ${errorMsg} for job ${job.id}`);
          db.prepare(
            `UPDATE recordings_jobs 
             SET status = 'failed', error = ?
             WHERE id = ?`
          ).run(errorMsg, job.id);
          resolve({ success: false, error: errorMsg });
        });
    } catch (err) {
      const errorMsg = `Unexpected error in FFmpeg setup: ${err.message}`;
      console.error(`[${RECORDER_ID}] ${errorMsg} for job ${job.id}`);
      db.prepare(
        `UPDATE recordings_jobs 
         SET status = 'failed', error = ?
         WHERE id = ?`
      ).run(errorMsg, job.id);
      resolve({ success: false, error: errorMsg });
    }
  });
}

async function pollAndRecord() {
  while (running) {
    try {
      // Try to lock a pending job
      const job = await tryLockJob();

      if (job) {
        currentJobId = job.id;
        console.log(`[${RECORDER_ID}] Starting recording for job ${job.id}`);
        await runFFmpeg(job);
        currentJobId = null;
        console.log(`[${RECORDER_ID}] Recording completed for job ${job.id}`);
      } else {
        // No jobs available, just wait for next poll
        await new Promise((resolve) => {
          pollInterval = setTimeout(resolve, POLL_INTERVAL_MS);
        });
      }
    } catch (err) {
      console.error(`[${RECORDER_ID}] Unexpected error in poll loop:`, err);
      // Continue polling despite errors
      await new Promise((resolve) => {
        pollInterval = setTimeout(resolve, POLL_INTERVAL_MS);
      });
    }
  }
}

async function gracefulShutdown() {
  console.log(`[${RECORDER_ID}] Shutting down gracefully...`);
  running = false;

  if (pollInterval) {
    clearTimeout(pollInterval);
  }

  // Kill FFmpeg process if running
  if (currentFfmpegProcess && !currentFfmpegProcess.killed) {
    console.log(`[${RECORDER_ID}] Terminating FFmpeg process (job ${currentJobId})...`);
    currentFfmpegProcess.kill("SIGTERM");

    // Wait up to 5 seconds for graceful termination
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (currentFfmpegProcess && !currentFfmpegProcess.killed) {
          console.log(`[${RECORDER_ID}] Force killing FFmpeg process...`);
          currentFfmpegProcess.kill("SIGKILL");
        }
        resolve();
      }, 5000);

      if (currentFfmpegProcess) {
        currentFfmpegProcess.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      } else {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  await closeDatabase();
  console.log(`[${RECORDER_ID}] Shutdown complete`);
  process.exit(0);
}

// Handle signals
process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

async function main() {
  console.log(`[${RECORDER_ID}] Starting...`);
  console.log(`[${RECORDER_ID}] Poll interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`[${RECORDER_ID}] Heartbeat interval: ${HEARTBEAT_INTERVAL_MS}ms`);

  await openDatabase();
  await ensureRecordingsDir();
  console.log(`[${RECORDER_ID}] Ready to record`);

  await pollAndRecord();
}

main().catch((err) => {
  console.error(`[${RECORDER_ID}] Fatal error:`, err);
  process.exit(1);
});
