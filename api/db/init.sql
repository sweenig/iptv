-- Recordings jobs table for server-side recording feature
CREATE TABLE IF NOT EXISTS recordings_jobs (
  id TEXT PRIMARY KEY,
  channel_url TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'recording', 'complete', 'failed', 'deleted')),
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
