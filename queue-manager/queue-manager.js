const Database = require("better-sqlite3");
const fs = require("node:fs/promises");
const path = require("node:path");

const DATA_DIR = process.env.DATA_DIR || "/data";
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || "/recordings";
const DB_PATH = path.join(DATA_DIR, "recordings.db");
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 10000);
const STALE_JOB_TIMEOUT_MS = Number(process.env.STALE_JOB_TIMEOUT_MS || 300000); // 5 minutes
const CLEANUP_DAYS = Number(process.env.CLEANUP_DAYS || 7);

let db = null;
let running = true;
let pollInterval = null;

async function openDatabase() {
  try {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    console.log(`[Queue Manager] Connected to database at ${DB_PATH}`);
  } catch (err) {
    console.error("[Queue Manager] Failed to open database:", err);
    process.exit(1);
  }
}

async function closeDatabase() {
  if (db) {
    try {
      db.close();
      console.log("[Queue Manager] Database closed");
    } catch (err) {
      console.error("[Queue Manager] Error closing database:", err);
    }
  }
}

async function resetStaleJobs() {
  try {
    if (!db) return;

    const now = new Date();
    const staleThreshold = new Date(now.getTime() - STALE_JOB_TIMEOUT_MS);

    // Find jobs that are recording but haven't updated heartbeat recently
    const staleJobs = db
      .prepare(
        `SELECT id, recorder_id, file_path 
         FROM recordings_jobs 
         WHERE status = 'recording' 
         AND (last_heartbeat IS NULL OR last_heartbeat < ?)`
      )
      .all(staleThreshold.toISOString());

    if (staleJobs.length > 0) {
      console.log(`[Queue Manager] Found ${staleJobs.length} stale recording job(s)`);

      // Reset each stale job to pending
      const resetStmt = db.prepare(
        `UPDATE recordings_jobs 
         SET status = 'pending', 
             recorder_id = NULL, 
             last_heartbeat = NULL,
             error = ?
         WHERE id = ?`
      );

      for (const job of staleJobs) {
        const errorMsg = `Job timeout: no heartbeat for ${STALE_JOB_TIMEOUT_MS / 1000}s`;
        resetStmt.run(errorMsg, job.id);
        console.log(
          `[Queue Manager] Reset stale job ${job.id} (was on recorder ${job.recorder_id})`
        );
      }
    }
  } catch (err) {
    console.error("[Queue Manager] Error checking for stale jobs:", err);
  }
}

async function cleanupOldRecordings() {
  try {
    if (!db) return;

    const cleanupDate = new Date();
    cleanupDate.setDate(cleanupDate.getDate() - CLEANUP_DAYS);

    // Find completed jobs older than cleanup threshold
    const oldJobs = db
      .prepare(
        `SELECT id, file_path, channel_name 
         FROM recordings_jobs 
         WHERE status = 'complete' 
         AND completed_at < ?`
      )
      .all(cleanupDate.toISOString());

    if (oldJobs.length > 0) {
      console.log(
        `[Queue Manager] Found ${oldJobs.length} old recording(s) to cleanup (older than ${CLEANUP_DAYS} days)`
      );

      for (const job of oldJobs) {
        try {
          // Delete the file if it exists
          if (job.file_path) {
            const fullPath = path.join(RECORDINGS_DIR, job.file_path);
            try {
              await fs.unlink(fullPath);
              console.log(`[Queue Manager] Deleted recording file: ${fullPath}`);
            } catch (err) {
              // File might not exist, which is okay
              if (err.code !== "ENOENT") {
                console.warn(
                  `[Queue Manager] Error deleting file ${fullPath}:`,
                  err.message
                );
              }
            }
          }

          // Delete the database record
          db.prepare("DELETE FROM recordings_jobs WHERE id = ?").run(job.id);
          console.log(`[Queue Manager] Deleted old recording record: ${job.id}`);
        } catch (err) {
          console.error(`[Queue Manager] Error cleaning up job ${job.id}:`, err);
        }
      }
    }
  } catch (err) {
    console.error("[Queue Manager] Error during cleanup:", err);
  }
}

async function reportStats() {
  try {
    if (!db) return;

    const stats = db
      .prepare(
        `SELECT 
         COUNT(*) as total,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
         SUM(CASE WHEN status = 'recording' THEN 1 ELSE 0 END) as recording,
         SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) as complete,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
         FROM recordings_jobs`
      )
      .get();

    console.log(
      `[Queue Manager] Stats: Total=${stats.total}, Pending=${stats.pending}, Recording=${stats.recording}, Complete=${stats.complete}, Failed=${stats.failed}`
    );
  } catch (err) {
    console.error("[Queue Manager] Error reporting stats:", err);
  }
}

async function pollQueue() {
  while (running) {
    try {
      // Check for and reset stale jobs
      await resetStaleJobs();

      // Cleanup old completed recordings
      await cleanupOldRecordings();

      // Report statistics
      await reportStats();

      // Wait for next poll
      await new Promise((resolve) => {
        pollInterval = setTimeout(resolve, POLL_INTERVAL_MS);
      });
    } catch (err) {
      console.error("[Queue Manager] Unexpected error in poll loop:", err);
      // Continue polling despite errors
      await new Promise((resolve) => {
        pollInterval = setTimeout(resolve, POLL_INTERVAL_MS);
      });
    }
  }
}

async function gracefulShutdown() {
  console.log("[Queue Manager] Shutting down gracefully...");
  running = false;

  if (pollInterval) {
    clearTimeout(pollInterval);
  }

  await closeDatabase();
  console.log("[Queue Manager] Shutdown complete");
  process.exit(0);
}

// Handle signals
process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

async function main() {
  console.log("[Queue Manager] Starting...");
  console.log(`[Queue Manager] Poll interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`[Queue Manager] Stale job timeout: ${STALE_JOB_TIMEOUT_MS}ms`);
  console.log(`[Queue Manager] Cleanup threshold: ${CLEANUP_DAYS} days`);

  await openDatabase();
  console.log("[Queue Manager] Ready to process jobs");

  await pollQueue();
}

main().catch((err) => {
  console.error("[Queue Manager] Fatal error:", err);
  process.exit(1);
});
