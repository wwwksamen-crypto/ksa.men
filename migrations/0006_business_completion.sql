PRAGMA foreign_keys=ON;

-- Immutable-style entitlement provenance. Rows are retained and may only be marked revoked;
-- the central service evaluator can select only active rows allowed by services.policy.
CREATE TABLE IF NOT EXISTS entitlement_sources (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('trial','subscription','points','grant')),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  revoked_at INTEGER,
  reference TEXT NOT NULL UNIQUE,
  detail TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  CHECK(ends_at >= starts_at),
  CHECK(revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX IF NOT EXISTS idx_entitlement_sources_active
  ON entitlement_sources(user_id,source_kind,ends_at)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_entitlement_sources_reference
  ON entitlement_sources(reference);

-- Backfill only provenance whose interval exists exactly in existing authoritative tables.
-- Historical generic grants remain represented by users.entitlement_until until an authorized
-- operator records an explicit source; they are never guessed from an aggregate timestamp.
INSERT OR IGNORE INTO entitlement_sources(
  id,user_id,source_kind,starts_at,ends_at,reference,detail,created_by,created_at
)
SELECT
  'entitlement-trial-' || id,id,'trial',created_at,trial_until,
  'trial-user-' || id,'Initial three-day trial',NULL,created_at
FROM users;

INSERT OR IGNORE INTO entitlement_sources(
  id,user_id,source_kind,starts_at,ends_at,reference,detail,created_by,created_at
)
SELECT
  'entitlement-subscription-' || id,user_id,'subscription',start_at,end_at,
  'subscription-' || id,'Approved paid subscription',NULL,created_at
FROM subscriptions;

-- Future account creation and paid subscriptions obtain provenance automatically. The existing
-- registration/payment effects remain authoritative for wallet and aggregate entitlement fields.
CREATE TRIGGER IF NOT EXISTS entitlement_source_trial_on_user
AFTER INSERT ON users
BEGIN
  INSERT OR IGNORE INTO entitlement_sources(
    id,user_id,source_kind,starts_at,ends_at,reference,detail,created_by,created_at
  ) VALUES(
    'entitlement-trial-' || NEW.id,NEW.id,'trial',NEW.created_at,NEW.trial_until,
    'trial-user-' || NEW.id,'Initial three-day trial',NULL,NEW.created_at
  );
END;

CREATE TRIGGER IF NOT EXISTS entitlement_source_subscription_on_insert
AFTER INSERT ON subscriptions
BEGIN
  INSERT OR IGNORE INTO entitlement_sources(
    id,user_id,source_kind,starts_at,ends_at,reference,detail,created_by,created_at
  ) VALUES(
    'entitlement-subscription-' || NEW.id,NEW.user_id,'subscription',NEW.start_at,NEW.end_at,
    'subscription-' || NEW.id,'Approved paid subscription',NULL,NEW.created_at
  );
END;
