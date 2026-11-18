PRAGMA foreign_keys=ON;

-- Selective alignment stage 2. Additive only; deliberately does NOT enable any
-- setting, schedule, erasure policy, public download, or existing-account change.
-- Nullable subjects preserve evidence without a permanent FK erasure blocker.
CREATE TABLE IF NOT EXISTS privacy_requests (
  id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK(type IN ('export','correction','erasure','objection')),
  status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','processing','ready','reviewing','answered','blocked','rejected','failed','expired','cancelled')),
  message TEXT NOT NULL DEFAULT '',
  public_response TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  UNIQUE(user_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_subject ON privacy_requests(user_id,created_at DESC,id);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_work ON privacy_requests(status,due_at,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_privacy_export_active ON privacy_requests(user_id)
  WHERE type='export' AND status IN ('received','processing','ready');

CREATE TABLE IF NOT EXISTS privacy_request_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES privacy_requests(id),
  actor_id INTEGER,
  status TEXT NOT NULL,
  event_code TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_privacy_events_request ON privacy_request_events(request_id,created_at,id);
CREATE TRIGGER IF NOT EXISTS privacy_event_append_only_update
  BEFORE UPDATE ON privacy_request_events BEGIN SELECT RAISE(ABORT,'Privacy events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS privacy_event_append_only_delete
  BEFORE DELETE ON privacy_request_events BEGIN SELECT RAISE(ABORT,'Privacy events are append-only'); END;

CREATE TABLE IF NOT EXISTS operational_jobs (
  id TEXT PRIMARY KEY,
  request_id TEXT UNIQUE REFERENCES privacy_requests(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK(kind IN ('privacy_export','backup_snapshot')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','succeeded','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER,
  next_attempt_at INTEGER NOT NULL,
  artifact_keys TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(artifact_keys)),
  last_error_code TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_operational_jobs_dispatch ON operational_jobs(kind,status,next_attempt_at,lease_until);

-- This table and operational_jobs are excluded from recoverable snapshots.
-- They contain runtime download capabilities, not historical privacy evidence.
CREATE TABLE IF NOT EXISTS privacy_export_artifacts (
  request_id TEXT PRIMARY KEY REFERENCES privacy_requests(id),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  bucket_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  generated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_privacy_artifact_expiry ON privacy_export_artifacts(expires_at);
