# Server-Side Recording Feature - Implementation Plan

## Overview
Add capability to record IPTV streams for configurable durations (0.5, 1, 1.5, 2, 2.5, 3, 3.5, or 4 hours with 5-10 min buffer). Users request recordings through the UI and can switch between live and recorded content.

## Feature Requirements
- Users click "Record" on a channel through existing UI
- Specify recording duration from predefined options
- Auto-complete recording after specified time (+ buffer)
- Channel list shows indicator with available recordings
- UI allows switching between live view and any recording
- Graceful playback switching in existing player

## Build Order (Do tasks in this sequence for incremental validation)

### Phase 1: Foundation & Infrastructure (4-6 hours)
1. **Rename & upgrade API container** (1h)
   - Rename `favorites-api` → `data-api` in docker-compose.yml and Dockerfile
   - Add SQLite3 npm package to api/package.json
   - Create `api/db/init.sql` with recordings schema
   - Add database initialization code to api/server.js
   - ✅ Validation: API boots, creates/initializes SQLite DB in `/data/recordings.db`

2. **Create queue-manager container** (2-3h)
   - New directory: `queue-manager/` with Dockerfile, package.json, queue-manager.js
   - Implement queue polling + stale job cleanup (see details below)
   - ✅ Validation: Container boots, runs without errors, polls every 10s, handles empty queue gracefully

3. **Create recorder container** (2-3h)
   - New directory: `recorder/` with Dockerfile, package.json, recorder.js
   - Implement job locking via SQLite transaction + FFmpeg wrapper
   - Add retry logic for network failures
   - ✅ Validation: Multiple replicas boot, grab unique IDs, poll queue, handle no-jobs gracefully

4. **Update docker-compose.yml** (30 min)
   - Add `queue-manager` service
   - Add `recorder` service with replicas: 3
   - Add `recordings_data` volume
   - Rename `favorites-api` → `data-api`
   - ✅ Validation: `docker-compose up` brings all services up, no errors in logs

### Phase 2: API Layer (3-4 hours)
5. **Add recording endpoints to data-api** (2-3h)
   - `POST /api/recordings/start` - Create new job, return job ID + estimated completion
   - `GET /api/recordings/list?channel_name=X` - List all recordings for a channel
   - `DELETE /api/recordings/:id` - Soft-delete recording, mark for cleanup
   - `GET /api/recordings/status/:id` - Poll recording progress
   - `GET /api/recordings/:id/download` - Stream MP4 file to client
   - ✅ Validation: Call `/api/recordings/start` via curl, verify job appears in DB, verify recorders pick it up

6. **Add nginx route for recordings** (30 min)
   - New nginx.conf location block: `/recordings/*` → static file serving from `/recordings` volume
   - ✅ Validation: Can download a test MP4 file via `http://localhost:8085/recordings/test.mp4`

### Phase 3: Recorder Implementation (4-6 hours)
7. **Implement recorder FFmpeg capture** (3-4h)
   - Recorder polls DB for `status='pending'` jobs
   - Atomic transaction: update to `status='recording'`, set `recorder_id`, `started_at`
   - Construct FFmpeg command with correct duration (+ buffer)
   - Stream to `/recordings/[channel_name]/recording-[timestamp]-[duration].mp4`
   - On completion: update to `status='complete'`, set `completed_at`, `file_path`
   - On error: set `status='failed'`, capture error message
   - ✅ Validation: Request 1-hour recording, verify FFmpeg runs, file appears, job status updates

8. **Add heartbeat + stale job recovery** (1-2h)
   - Recorder updates `last_heartbeat` every 30s during recording
   - Queue manager: any job with `status='recording'` AND no heartbeat >5min → reset to `pending`
   - Queue manager: cleanup old completed jobs (>7 days old) and their files
   - ✅ Validation: Kill a recorder mid-job, verify job respawns on another recorder within 5min

### Phase 4: Frontend UI (2-3 hours)
9. **Add recording request UI** (1.5h)
   - Add "Record" button next to each channel's favorite star
   - On click: modal with duration options (0.5h, 1h, 1.5h, 2h, 2.5h, 3h, 3.5h, 4h)
   - Call `POST /api/recordings/start`, show confirmation
   - ✅ Validation: Click Record, select duration, see success message

10. **Add recordings list to channel** (1h)
    - Show "📹 (N)" badge if channel has completed recordings
    - Click badge → dropdown list of recordings with timestamps + size
    - Click recording → switch player to playback mode
    - ✅ Validation: See recordings appear after completion, can select and playback

11. **Add playback switching** (30 min)
    - Modify player to support local MP4 playback (new video element or player mode)
    - Add dropdown in player: "Live" vs. "Recording 1", "Recording 2", etc.
    - On selection: fetch file URL from API, load into player
    - ✅ Validation: Record something, playback recording in UI works smoothly

### Phase 5: Testing & Polish (2-3 hours)
12. **End-to-end testing** (1-2h)
    - Test with real IPTV stream
    - Record multiple channels simultaneously (use 5 replicas)
    - Verify file integrity + playback quality
    - Test edge cases: network interruption, disk full, container restart

13. **Storage & cleanup** (30 min)
    - Implement auto-cleanup logic in queue-manager: delete files >7 days old
    - Add config option: max recordings per channel (optional)
    - Monitor `/recordings` volume usage

## Architecture

### Approach
**SQLite-based job queue with replica recording containers** to support multiple concurrent recordings (UPDATED from file-based)

### Components

#### 1. Data API Container (Renamed from favorites-api)
- Upgraded with SQLite database for recording jobs
- Existing endpoints: favorites, blacklist (unchanged)
- **New endpoints for recordings:**
  - `POST /api/recordings/start` - Create new job in DB, return ID
  - `GET /api/recordings/list?channel_name=X` - Query DB for channel's recordings
  - `DELETE /api/recordings/:id` - Soft-delete, mark for cleanup
  - `GET /api/recordings/status/:id` - Poll job progress from DB
  - `GET /api/recordings/:id/download` - Stream MP4 file
- Initialization: creates SQLite schema on startup if doesn't exist
- **One instance only** — handles all request-response workload

#### 2. Queue Manager Container (New)
- Runs continuously as background process
- **Responsibilities:**
  - Poll `/data/recordings.db` every 10s for new `pending` jobs
  - Monitor `recording` jobs: if no heartbeat >5min → reset to `pending` (recovery)
  - Cleanup: delete completed jobs >7 days old + their files
  - Log warnings for failed recordings (error field set)
- Does NOT run FFmpeg; only manages job state
- Single instance (no replicas needed)

#### 3. Recorder Containers (New - Replicas)
- Multiple independent instances (configurable: start with 3, scale to 5-8)
- Each instance has unique `RECORDER_ID` environment variable
- **Responsibilities:**
  - Poll DB every 3-5s for `pending` jobs
  - Atomically lock via SQLite transaction: `UPDATE recordings_jobs SET status='recording', recorder_id=? WHERE id=? AND status='pending'`
  - Run FFmpeg command to stream URL → MP4 file
  - Update heartbeat every 30s: `UPDATE recordings_jobs SET last_heartbeat=NOW() WHERE id=?`
  - On success: `UPDATE status='complete', completed_at=NOW(), file_path='/recordings/...'`
  - On error: `UPDATE status='failed', error='...'`
  - Loop: back to polling
- No inter-container communication needed; all coordination via DB

#### 4. Frontend UI Changes (app.js)
- Add "Record" button per channel in sidebar
- Duration selector modal (0.5h, 1h, 1.5h, etc.)
- Show recording indicator on channels with recordings
- Recordings dropdown/tab for each channel
- Switch playback between live and recordings
- Support local MP4 file playback (not just HLS/DASH)

## Current System Context
- **Web Frontend**: nginx serving index.html + app.js + styles.css
- **API Server**: Node.js (port 3000) handles favorites/blacklist persistence
- **Data Volume**: `favorites_data` at `/data` for persistent storage
- **Database**: SQLite in `/data/recordings.db` (new)
- **Recordings Volume**: `/recordings` stores MP4 files organized by channel
- **Player**: Client-side HLS.js and dash.js, direct stream from source; will add local MP4 support

## Implementation Details

### Directory Structure to Add
```
queue-manager/
  ├─ Dockerfile
  ├─ queue-manager.js (polling + cleanup logic)
  └─ package.json

recorder/
  ├─ Dockerfile
  ├─ recorder.js (job polling + FFmpeg wrapper)
  └─ package.json

api/
  ├─ db/
  │   └─ init.sql (SQLite schema)
  ├─ Dockerfile (updated)
  └─ server.js (updated with recording endpoints)

recordings_data/ (Docker volume)
  └─ [channel-name]/
      ├─ recording-[timestamp]-[duration].mp4
      └─ recording-[timestamp]-[duration].json (metadata)
```

### SQLite Schema

**`api/db/init.sql`** (auto-created on first API startup)
```sql
CREATE TABLE IF NOT EXISTS recordings_jobs (
  id TEXT PRIMARY KEY,
  channel_url TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'recording', 'complete', 'failed')),
  recorder_id TEXT,
  file_path TEXT,
  error TEXT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  last_heartbeat TIMESTAMP,
  
  UNIQUE(file_path)
);

CREATE INDEX IF NOT EXISTS idx_status ON recordings_jobs(status);
CREATE INDEX IF NOT EXISTS idx_channel ON recordings_jobs(channel_name);
CREATE INDEX IF NOT EXISTS idx_heartbeat ON recordings_jobs(last_heartbeat);
```

### Docker Compose Updates (UPDATED)
Replace `favorites-api` with `data-api` and add:
```yaml
services:
  iptv-web:
    # ... (unchanged)
    depends_on:
      - data-api  # renamed from favorites-api

  data-api:  # renamed from favorites-api
    build: ./api
    container_name: iptv-data-api
    environment:
      - PORT=3000
      - DATA_DIR=/data
    volumes:
      - favorites_data:/data
    restart: unless-stopped

  queue-manager:
    build: ./queue-manager
    container_name: iptv-queue-manager
    depends_on:
      - data-api
    environment:
      - DATA_DIR=/data
      - RECORDINGS_DIR=/recordings
      - POLL_INTERVAL_MS=10000
      - STALE_JOB_TIMEOUT_MS=300000  # 5 minutes
      - CLEANUP_DAYS=7
    volumes:
      - favorites_data:/data
      - recordings_data:/recordings
    restart: unless-stopped

  recorder:
    build: ./recorder
    depends_on:
      - data-api
    environment:
      - DATA_DIR=/data
      - RECORDINGS_DIR=/recordings
      - POLL_INTERVAL_MS=3000
      - HEARTBEAT_INTERVAL_MS=30000
    volumes:
      - favorites_data:/data
      - recordings_data:/recordings
    deploy:
      replicas: 3
    restart: unless-stopped

volumes:
  favorites_data:
  recordings_data:
```

### Job State Machine
```
    ┌─────────┐
    │ pending │  (created by API)
    └────┬────┘
         │ (recorder picks up, atomic lock)
    ┌────▼─────────┐
    │  recording   │  (heartbeat every 30s)
    └────┬────────┬┘
         │        │ (network error/crash)
         │        └─────────────┐
         │                      │ (stale >5min)
         │                      │
    ┌────▼────────┐      ┌──────▼──┐
    │  complete   │      │ pending  │  (retry)
    └─────────────┘      └──────────┘
              ▲
              └─ (cleaned up after 7 days)
              
         OR
              
    ┌──────────┐
    │ failed   │  (if error or max retries)
    └──────────┘
```

### Locking Strategy (SQLite)
```javascript
// Atomic job acquisition in recorder:
BEGIN TRANSACTION;
  SELECT * FROM recordings_jobs WHERE status='pending' LIMIT 1;
  UPDATE recordings_jobs 
    SET status='recording', recorder_id=?, started_at=NOW()
    WHERE id=? AND status='pending';
COMMIT;
```
- SQLite handles ACID guarantees; no two recorders can lock same job
- If transaction fails, recorder backs off and retries next poll
- Heartbeat: simple UPDATE with `last_heartbeat=NOW()` every 30s

### Storage Considerations
- Recordings stored as MP4 (H.264 video + AAC audio)
- Each hour ~= 1-2GB depending on bitrate
- Max concurrent: 4h × 5 replicas = 20GB potential peak storage
- Implement cleanup: auto-delete old recordings after N days (configurable)

## Frontend Integration

### UI Changes
1. Add recording request button next to favorites star
2. Duration selector on click
3. Show "📹 (2)" badge on channel if 2 recordings exist
4. Click badge → dropdown showing recordings with timestamps
5. Click recording → load into player (separate player instance or switch stream)

### Player Changes
- Support playback of local MP4 files via nginx
- Serve recordings at `/recordings/[channel-name]/[file-id].mp4`
- Add playback mode toggle in player (Live vs. Recording dropdown)

## Technical Considerations

### FFmpeg Command Template
```bash
ffmpeg -i "[STREAM_URL]" \
  -c:v copy -c:a copy \
  -t [DURATION_SECONDS] \
  -f mp4 \
  "[OUTPUT_PATH]"
```
- Use `-c:v copy -c:a copy` to avoid re-encoding (fast, low CPU)
- Timeout buffer: add 5-10 min to duration for safety

### Error Handling
- Network interruption during recording: FFmpeg will timeout, error logged, job marked failed
- Out of disk space: FFmpeg fails, error captured, job marked failed, queue-manager alerts via API
- Recorder container crash: job status remains "recording", heartbeat will stale, queue-manager resets to pending after 5min
- Malformed recordings: if file incomplete, job marked with error flag; cleanup deletes it
- Max retries: consider adding retry_count field; after 3 failed attempts, mark as failed (not retried)

### Estimated Effort (UPDATED with build order)

| Phase | Task | Effort |
|-------|------|--------|
| 1 | Rename API + add SQLite | 1h |
| 1 | Create queue-manager service | 2-3h |
| 1 | Create recorder service | 2-3h |
| 1 | Update docker-compose.yml | 30m |
| 2 | Add recording API endpoints | 2-3h |
| 2 | Add nginx recordings route | 30m |
| 3 | Implement FFmpeg capture in recorder | 3-4h |
| 3 | Add heartbeat + stale job recovery | 1-2h |
| 4 | Add record UI button + modal | 1.5h |
| 4 | Add recordings list & playback switching | 1.5h |
| 5 | End-to-end testing | 1-2h |
| 5 | Storage cleanup & monitoring | 30m |
| **Total** | | **~18-22 hours** |

**Why SQLite saves time:** Eliminates race condition debugging. Atomic transactions handle job locking automatically. No heartbeat polling hacks needed.

## Recommended Validation Checkpoints (After each task, verify before moving forward)

1. **After renaming API:** `docker-compose up` → both services boot, API creates `recordings.db`
2. **After queue-manager:** Logs show "Polling jobs..." every 10s, no crashes
3. **After recorder:** Multiple instances boot, each with unique RECORDER_ID
4. **After docker-compose update:** All 8-9 containers run successfully
5. **After API endpoints:** `curl POST /api/recordings/start` creates job in DB
6. **After nginx route:** `curl http://localhost:8085/recordings/test.mp4` works (test file)
7. **After FFmpeg implementation:** Request 1-min test recording, verify MP4 file appears + job completes
8. **After heartbeat:** Kill recorder mid-job, verify job respawns after 5min
9. **After UI:** Can click "Record", see modal, submit request
10. **After recordings list:** Completed recording appears in dropdown, clickable
11. **After playback:** Can actually play back recording in player
12. **Full e2e:** Record real channel, play it back, multiple concurrent recordings work

## Next Steps (When Ready)
1. Rename `api/` directory volume and service name to `data-api` in docker-compose
2. Create `queue-manager/` directory structure
3. Create `recorder/` directory structure
4. Add SQLite schema file
5. Follow build order Phase 1-5 above
6. Test incrementally after each phase

## Notes
- **Architecture is elegant:** 1 web, 1 API, 1 queue-manager, 3-8 recorders. Simple to understand and scale.
- **SQLite over file-based:** ACID transactions eliminate race conditions. Much simpler locking. No heartbeat polling hacks.
- **Single API instance:** Node.js async handles all request traffic easily. Recorders don't strain it. Scale recorders, not API.
- **Queue manager & recorders share DB:** All coordination via SQLite, no inter-container networking. Simple and robust.
- **Recordings isolated by channel:** Easy to organize, delete per-channel, and compute storage usage.
- **Local MP4 playback:** Nginx serves files statically. Video element in player. Clean separation of concerns.
- **Future enhancements:** Recording schedules ("record every weekday 8pm"), storage quotas per channel, retention policies, export to cloud.
- **No external dependencies:** Everything uses Node.js + SQLite + FFmpeg (system tool). No Redis, no external DB, no message queue.

## Container Topology at Full Scale
```
Client Browser
    │
    └── :8085 ──┬─────→ nginx (iptv-web)
                │       ├─ serves UI (index.html, app.js, styles.css)
                │       └─ reverse proxy /api/* → data-api
                │
                ├────→ http://data-api:3000 (iptv-data-api)
                │       ├─ GET /api/favorites, POST /api/favorites
                │       ├─ GET /api/blacklist, POST /api/blacklist
                │       ├─ POST /api/recordings/start
                │       ├─ GET /api/recordings/list
                │       ├─ GET /api/recordings/status/:id
                │       └─ DELETE /api/recordings/:id
                │
                └── /recordings/* → nginx static serve (MP4 files)

Background processes:
  queue-manager (1 instance)
    └─ Polls DB every 10s
       ├─ Reset stale jobs (no heartbeat >5min)
       └─ Cleanup old recordings (>7 days)
       
  recorder (3-8 instances)
    └─ Each polls DB every 3-5s
       ├─ Lock & start pending job
       ├─ Run FFmpeg capture
       ├─ Heartbeat every 30s
       └─ Mark complete/failed

Data layer:
  /data/favorites.json (existing)
  /data/blacklist.json (existing)
  /data/recordings.db (new, SQLite)
  /recordings/[channel_name]/ (new, MP4 files)
