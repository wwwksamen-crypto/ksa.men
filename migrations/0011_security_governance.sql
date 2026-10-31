PRAGMA foreign_keys=ON;

-- Phase 2 is additive only. Existing records are retained; new controls apply from this migration onward.
ALTER TABLE sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN revocation_reason TEXT;
ALTER TABLE devices ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE devices ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE devices ADD COLUMN revocation_reason TEXT;

ALTER TABLE audit ADD COLUMN prev_hash TEXT;
ALTER TABLE audit ADD COLUMN row_hash TEXT;
CREATE TABLE IF NOT EXISTS audit_chain_state (
  chain_name TEXT PRIMARY KEY CHECK(chain_name='primary'),
  anchor_audit_id INTEGER NOT NULL DEFAULT 0,
  last_audit_id INTEGER NOT NULL DEFAULT 0,
  last_hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO audit_chain_state(chain_name,anchor_audit_id,last_audit_id,last_hash,updated_at)
SELECT 'primary',COALESCE(MAX(id),0),COALESCE(MAX(id),0),'legacy-anchor-v1:'||COALESCE(MAX(id),0),strftime('%s','now') FROM audit;
CREATE INDEX IF NOT EXISTS idx_audit_chain_rows ON audit(id,row_hash);
CREATE TRIGGER IF NOT EXISTS audit_append_only_update
BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'Audit records are append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_append_only_delete
BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'Audit records are append-only'); END;

-- A granular, versioned receipt of voluntary consent. It stores purpose and policy version,
-- not the profile payload or translated text.
CREATE TABLE IF NOT EXISTS consent_records (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  purpose TEXT NOT NULL CHECK(purpose IN ('account_creation','public_profile','translation','contact')),
  notice_version TEXT NOT NULL,
  question TEXT NOT NULL,
  affirmation TEXT NOT NULL,
  source TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  withdrawn_at INTEGER,
  CHECK(withdrawn_at IS NULL OR withdrawn_at>=granted_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_consent_active_purpose ON consent_records(user_id,purpose) WHERE withdrawn_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_consent_user_history ON consent_records(user_id,granted_at DESC);

-- Retention holds are recorded explicitly and block destructive processing until released.
CREATE TABLE IF NOT EXISTS retention_holds (
  id TEXT PRIMARY KEY,
  user_id INTEGER,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  legal_basis TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','released')),
  created_at INTEGER NOT NULL,
  released_at INTEGER,
  created_by INTEGER REFERENCES users(id),
  CHECK(released_at IS NULL OR released_at>=created_at)
);
CREATE INDEX IF NOT EXISTS idx_retention_holds_active ON retention_holds(user_id,resource_type,resource_id) WHERE status='active';

-- Tombstones have identifiers only. They are intentionally immutable and prevent a restored
-- pre-erasure backup from reintroducing a destroyed account, site, media object or conversation.
CREATE TABLE IF NOT EXISTS deleted_tombstones (
  resource_type TEXT NOT NULL CHECK(resource_type IN ('account','site','media','conversation','message')),
  resource_id TEXT NOT NULL,
  deletion_request_id TEXT,
  deleted_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY(resource_type,resource_id)
);
CREATE TRIGGER IF NOT EXISTS deleted_tombstones_no_update
BEFORE UPDATE ON deleted_tombstones BEGIN SELECT RAISE(ABORT,'Deleted tombstones are immutable'); END;
CREATE TRIGGER IF NOT EXISTS deleted_tombstones_no_delete
BEFORE DELETE ON deleted_tombstones BEGIN SELECT RAISE(ABORT,'Deleted tombstones are immutable'); END;

ALTER TABLE deletion_requests ADD COLUMN requested_action TEXT NOT NULL DEFAULT 'archive';
ALTER TABLE deletion_requests ADD COLUMN scheduled_for INTEGER;
ALTER TABLE deletion_requests ADD COLUMN hidden_at INTEGER;
ALTER TABLE deletion_requests ADD COLUMN archived_at INTEGER;
ALTER TABLE deletion_requests ADD COLUMN executed_at INTEGER;
ALTER TABLE deletion_requests ADD COLUMN blocked_reason TEXT;
ALTER TABLE deletion_requests ADD COLUMN notice_version TEXT;
CREATE INDEX IF NOT EXISTS idx_deletion_lifecycle ON deletion_requests(status,scheduled_for,created_at);

-- R2 object removal is queued durably; a failed object deletion stays inaccessible in D1 and is retried by Cron.
CREATE TABLE IF NOT EXISTS media_purge_queue (
  id TEXT PRIMARY KEY,
  deletion_request_id TEXT,
  media_id TEXT NOT NULL,
  bucket_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','deleted','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_purge_once ON media_purge_queue(media_id,bucket_key);
CREATE INDEX IF NOT EXISTS idx_media_purge_pending ON media_purge_queue(status,created_at);

-- Internal Records of Processing Activities and vendor data-flow inventory. No credentials are stored here.
CREATE TABLE IF NOT EXISTS ropa_activities (
  id TEXT PRIMARY KEY,
  activity TEXT NOT NULL,
  data_categories TEXT NOT NULL,
  data_subjects TEXT NOT NULL,
  purpose TEXT NOT NULL,
  legal_basis TEXT NOT NULL,
  retention_policy TEXT NOT NULL,
  access_roles TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS data_flow_map (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  service TEXT NOT NULL,
  purpose TEXT NOT NULL,
  data_categories TEXT NOT NULL,
  transfer_note TEXT NOT NULL,
  safeguards TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO ropa_activities(id,activity,data_categories,data_subjects,purpose,legal_basis,retention_policy,access_roles,updated_at) VALUES
 ('account-identity','Account identity and authentication','Email, display name, phone, session/device pseudonyms','Members','Create and secure accounts','Contract / consent as captured','Auth codes expire; sessions and devices are revocable','Member, owner',strftime('%s','now')),
 ('public-identity','Professional profile publication','Chosen profile fields and media','Members, visitors','Publish an approved professional identity','Explicit publication consent','Until withdrawn, archived, or deleted','Member, reviewer, owner',strftime('%s','now')),
 ('communications','Consent-based contact requests','Member identifiers, contact request, short-lived messages','Members','Allow approved professional contact','Explicit contact consent','Expiry and lifecycle purge policy','Member, safety roles',strftime('%s','now'));
INSERT OR IGNORE INTO data_flow_map(id,provider,service,purpose,data_categories,transfer_note,safeguards,updated_at) VALUES
 ('cloudflare-worker','Cloudflare','Workers, D1, R2','Application execution, data storage and media delivery','Account, profile, media and operational metadata','Data location requires provisioning-time verification; existing resources are not silently represented as Saudi-local','TLS, least-privilege bindings, encrypted backups, private media authorization',strftime('%s','now')),
 ('resend-auth','Resend','Transactional authentication email','Deliver one-time verification codes','Email address and authentication message','Email is sent only after a user-initiated verification request','Scoped API key, rate limits, expiring single-use codes',strftime('%s','now'));
INSERT INTO settings(key,value) VALUES('privacy_notice_version','"2026-10-31"') ON CONFLICT(key) DO NOTHING;
