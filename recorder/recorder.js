const Database = require("better-sqlite3");
const { spawn, execSync } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const DATA_DIR = process.env.DATA_DIR || "/data";
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || "/recordings";
const DB_PATH = path.join(DATA_DIR, "recordings.db");
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 3000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS || 30000);
const MAX_RETRY_ATTEMPTS = Number(process.env.MAX_RETRY_ATTEMPTS || 5);
const RETRY_DELAY_MS = Number(process.env.RETRY_DELAY_MS || 3000);

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

// Convert TS file to MP4
async function convertTsToMp4(tsPath, mp4Path, jobId) {
  return new Promise((resolve) => {
    console.log(`[${RECORDER_ID}] Converting ${path.basename(tsPath)} to MP4 for job ${jobId}`);
    
    const ffmpegProcess = spawn("ffmpeg", [
      "-i",
      tsPath,
      "-c:v",
      "copy",
      "-c:a",
      "copy",
      "-f",
      "mp4",
      mp4Path,
    ]);

    let errorOutput = "";
    ffmpegProcess.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    ffmpegProcess.on("exit", (code) => {
      if (code === 0) {
        console.log(`[${RECORDER_ID}] Conversion completed successfully for job ${jobId}`);
        // Delete TS file after successful conversion
        fs.unlink(tsPath)
          .then(() => {
            console.log(`[${RECORDER_ID}] Deleted temporary TS file for job ${jobId}`);
            resolve({ success: true });
          })
          .catch((err) => {
            console.warn(`[${RECORDER_ID}] Could not delete TS file: ${err.message}`);
            resolve({ success: true }); // Still consider conversion successful
          });
      } else {
        const error = `TS to MP4 conversion failed with code ${code}`;
        console.error(`[${RECORDER_ID}] ${error} for job ${jobId}`);
        resolve({ success: false, error });
      }
    });

    ffmpegProcess.on("error", (err) => {
      const errorMsg = `FFmpeg conversion spawn error: ${err.message}`;
      console.error(`[${RECORDER_ID}] ${errorMsg} for job ${jobId}`);
      resolve({ success: false, error: errorMsg });
    });
  });
}

async function runFFmpeg(job) {
  return new Promise((resolve) => {
    try {
      // Ensure channel-specific directory exists
      const sanitizedChannelName = sanitizeChannelName(job.channel_name);
      const channelDir = path.join(RECORDINGS_DIR, sanitizedChannelName);
      fs.mkdir(channelDir, { recursive: true })
        .then(() => {
          const timestamp = Date.now();
          const tsFilename = `recording-${timestamp}-${job.duration_minutes}m.ts`;
          const mp4Filename = `recording-${timestamp}-${job.duration_minutes}m.mp4`;
          const tsPath = path.join(channelDir, tsFilename);
          const mp4Path = path.join(channelDir, mp4Filename);
          const filePathForDb = path.join(sanitizedChannelName, mp4Filename);

          // Calculate total duration with 5-10 minute buffer (in seconds)
          const bufferMinutes = 7;
          const totalSeconds = (job.duration_minutes + bufferMinutes) * 60;
          const recordingStartTime = Date.now();
          let retryCount = 0;

          const startRecording = () => {
            console.log(
              `[${RECORDER_ID}] Starting FFmpeg (attempt ${retryCount + 1}) for job ${job.id}: ${job.channel_url} -> ${tsPath}`
            );

            // Record to TS format with retry capability
            currentFfmpegProcess = spawn("ffmpeg", [
              "-i",
              job.channel_url,
              "-c:v",
              "copy",
              "-c:a",
              "copy",
              "-t",
              String(totalSeconds),
              "-f",
              "mpegts",
              tsPath,
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

              const elapsedSeconds = (Date.now() - recordingStartTime) / 1000;
              const shouldRetry = code !== 0 && retryCount < MAX_RETRY_ATTEMPTS && elapsedSeconds < totalSeconds;

              if (code === 0 || !shouldRetry) {
                // Recording complete (either succeeded or max retries reached)
                console.log(
                  `[${RECORDER_ID}] Recording session ended for job ${job.id} (code: ${code}, elapsed: ${elapsedSeconds.toFixed(1)}s)`
                );

                // Convert TS to MP4
                convertTsToMp4(tsPath, mp4Path, job.id).then((conversionResult) => {
                  if (!conversionResult.success) {
                    const error = conversionResult.error || "Conversion failed";
                    db.prepare(
                      `UPDATE recordings_jobs 
                       SET status = 'failed', error = ?
                       WHERE id = ?`
                    ).run(error, job.id);
                    resolve({ success: false, error });
                    return;
                  }

                  // Get actual video duration using ffprobe
                  let actualDurationMinutes = job.duration_minutes;
                  try {
                    const ffprobeOutput = execSync(
                      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${mp4Path}"`
                    ).toString().trim();
                    const durationSeconds = parseFloat(ffprobeOutput);
                    if (!isNaN(durationSeconds)) {
                      actualDurationMinutes = Math.round((durationSeconds / 60) * 100) / 100;
                      console.log(`[${RECORDER_ID}] Actual duration: ${actualDurationMinutes}m (${durationSeconds}s)`);
                    }
                  } catch (err) {
                    console.warn(`[${RECORDER_ID}] Could not get video duration: ${err.message}`);
                  }

                  // Mark job as complete
                  const now = new Date().toISOString();
                  db.prepare(
                    `UPDATE recordings_jobs 
                     SET status = 'complete', completed_at = ?, file_path = ?, duration_minutes = ?
                     WHERE id = ?`
                  ).run(now, filePathForDb, actualDurationMinutes, job.id);
                  resolve({ success: true });
                });
              } else {
                // Stream interrupted, retry
                retryCount++;
                console.log(
                  `[${RECORDER_ID}] Stream interrupted after ${elapsedSeconds.toFixed(1)}s, retrying in ${RETRY_DELAY_MS}ms (attempt ${retryCount}/${MAX_RETRY_ATTEMPTS})`
                );
                setTimeout(startRecording, RETRY_DELAY_MS);
              }
            });

            currentFfmpegProcess.on("error", (err) => {
              clearInterval(heartbeatTimer);
              currentFfmpegProcess = null;

              const elapsedSeconds = (Date.now() - recordingStartTime) / 1000;
              const shouldRetry = retryCount < MAX_RETRY_ATTEMPTS && elapsedSeconds < totalSeconds;

              if (shouldRetry) {
                retryCount++;
                console.log(
                  `[${RECORDER_ID}] FFmpeg error: ${err.message}, retrying in ${RETRY_DELAY_MS}ms (attempt ${retryCount}/${MAX_RETRY_ATTEMPTS})`
                );
                setTimeout(startRecording, RETRY_DELAY_MS);
              } else {
                const errorMsg = `FFmpeg spawn error: ${err.message}`;
                console.error(`[${RECORDER_ID}] ${errorMsg} for job ${job.id}`);
                db.prepare(
                  `UPDATE recordings_jobs 
                   SET status = 'failed', error = ?
                   WHERE id = ?`
                ).run(errorMsg, job.id);
                resolve({ success: false, error: errorMsg });
              }
            });
          };

          // Start recording
          startRecording();
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
