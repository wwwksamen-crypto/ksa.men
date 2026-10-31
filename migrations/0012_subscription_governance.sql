PRAGMA foreign_keys=ON;

-- Phase 4: member-requested free-trial extensions and negotiated annual membership.
-- Historical payment records remain intact; new member intake does not collect prices or receipts.
CREATE TABLE IF NOT EXISTS subscription_requests (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('trial_extension','annual_contact')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','changes_requested')),
  member_note TEXT NOT NULL DEFAULT '',
  admin_reason TEXT NOT NULL DEFAULT '',
  decided_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  applied_until INTEGER,
  CHECK(decided_at IS NULL OR decided_at>=created_at)
);
CREATE INDEX IF NOT EXISTS idx_subscription_requests_queue
  ON subscription_requests(status,kind,created_at);
CREATE INDEX IF NOT EXISTS idx_subscription_requests_member
  ON subscription_requests(user_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_requests_one_pending
  ON subscription_requests(user_id,kind) WHERE status='pending';

-- New registrations receive the seven-day interval in the registration path. The
-- provenance trigger already records NEW.trial_until exactly, so this migration
-- preserves existing earned history and does not alter any earlier database object.
