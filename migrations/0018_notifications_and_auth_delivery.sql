-- User-facing dismissal never removes notifications or the authoritative audit trail.
ALTER TABLE notifications ADD COLUMN dismissed_at INTEGER;
ALTER TABLE notifications ADD COLUMN action_url TEXT;
CREATE INDEX IF NOT EXISTS idx_notifications_inbox ON notifications(user_id,dismissed_at,created_at DESC,id DESC);

-- A trusted account's budget is separate from unverified-browser requests.
CREATE TABLE IF NOT EXISTS auth_mail_daily_limits (
 bucket TEXT PRIMARY KEY,
 user_id INTEGER REFERENCES users(id),
 day_key TEXT NOT NULL,
 primary_used INTEGER NOT NULL DEFAULT 0 CHECK(primary_used IN (0,1)),
 backup_used INTEGER NOT NULL DEFAULT 0 CHECK(backup_used IN (0,1)),
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mail_delivery_events (
 event_key TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id),
 state TEXT NOT NULL CHECK(state IN ('sending','sent','failed','uncertain')),
 channel TEXT NOT NULL DEFAULT 'unavailable',
 created_at INTEGER NOT NULL,
 finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mail_delivery_user ON mail_delivery_events(user_id,created_at);
ALTER TABLE managed_claim_tokens ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'sent';
CREATE TABLE IF NOT EXISTS managed_creation_requests (
 created_by INTEGER NOT NULL REFERENCES users(id),
 request_key TEXT NOT NULL,
 input_hash TEXT NOT NULL,
 site_id TEXT NOT NULL REFERENCES sites(id),
 user_id INTEGER NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(created_by,request_key)
);

-- Occasion notices remain opt-in, in-app only under the current product policy.
UPDATE occasion_notices SET email_status='in_app_only' WHERE email_status IS NULL OR email_status='pending';

-- Existing approvals may have been emailed before delivery receipts existed.
-- Preserve uncertainty rather than resend historical events or claim delivery.
INSERT OR IGNORE INTO mail_delivery_events(event_key,user_id,state,channel,created_at,finished_at)
SELECT 'publication:'||d.review_id,s.user_id,'uncertain','legacy',d.decided_at,d.decided_at
FROM review_decisions d JOIN reviews r ON r.id=d.review_id JOIN sites s ON s.id=r.site_id
WHERE d.status='approved';
