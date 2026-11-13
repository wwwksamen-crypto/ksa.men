-- Isolated candidate only. Never apply without separate deployment approval.
CREATE TABLE IF NOT EXISTS upload_intents (
 id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL, site_id TEXT,
 bucket_key TEXT NOT NULL UNIQUE, purpose TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('staged','ready','failed')),
 created_at INTEGER NOT NULL, finished_at INTEGER, error_name TEXT
);
CREATE INDEX IF NOT EXISTS idx_upload_intent_pending ON upload_intents(state,created_at);
ALTER TABLE mail_delivery_events ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mail_delivery_events ADD COLUMN last_attempt_at INTEGER;
ALTER TABLE mail_delivery_events ADD COLUMN next_attempt_at INTEGER;
ALTER TABLE mail_delivery_events ADD COLUMN lease_token TEXT;
ALTER TABLE mail_delivery_events ADD COLUMN payload_hash TEXT;
UPDATE mail_delivery_events SET attempts=1,last_attempt_at=created_at WHERE attempts=0;
