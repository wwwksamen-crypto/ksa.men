PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS managed_accounts (
 user_id INTEGER PRIMARY KEY REFERENCES users(id),
 contact_email TEXT NOT NULL,
 created_by INTEGER NOT NULL REFERENCES users(id),
 managed_by INTEGER NOT NULL REFERENCES users(id),
 status TEXT NOT NULL DEFAULT 'managed' CHECK(status IN ('managed','claimed')),
 created_at INTEGER NOT NULL,
 claimed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_managed_accounts_operator ON managed_accounts(managed_by,status);
CREATE TABLE IF NOT EXISTS managed_claim_tokens (
 token_hash TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES managed_accounts(user_id),
 contact_email TEXT NOT NULL,
 created_by INTEGER NOT NULL REFERENCES users(id),
 expires_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 revoked_at INTEGER,
 consumed_at INTEGER,
 accepted_pin_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_managed_claim_user ON managed_claim_tokens(user_id,created_at);
CREATE TRIGGER IF NOT EXISTS managed_claim_accept_guard
BEFORE UPDATE OF consumed_at ON managed_claim_tokens WHEN NEW.consumed_at IS NOT NULL
BEGIN
 SELECT CASE WHEN OLD.consumed_at IS NOT NULL OR OLD.revoked_at IS NOT NULL OR OLD.expires_at<NEW.consumed_at
   OR NOT EXISTS(SELECT 1 FROM managed_accounts m JOIN users u ON u.id=m.user_id
                 WHERE m.user_id=NEW.user_id AND m.status='managed' AND u.role='user' AND u.status='active')
   OR NEW.accepted_pin_hash IS NULL
   THEN RAISE(ABORT,'Claim is unavailable') END;
END;
CREATE TRIGGER IF NOT EXISTS managed_claim_accept_effect
AFTER UPDATE OF consumed_at ON managed_claim_tokens WHEN OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL
BEGIN
 UPDATE managed_accounts SET status='claimed',contact_email=NEW.contact_email,claimed_at=NEW.consumed_at WHERE user_id=NEW.user_id;
 UPDATE users SET pin_hash=NEW.accepted_pin_hash,consent_at=NEW.consumed_at,assigned_to=NULL WHERE id=NEW.user_id AND role='user';
 UPDATE sites SET manager_id=NULL WHERE user_id=NEW.user_id;
 UPDATE sessions SET revoked=1,revocation_reason='managed_account_claimed' WHERE user_id=NEW.user_id;
 UPDATE devices SET revoked=1,revocation_reason='managed_account_claimed' WHERE user_id=NEW.user_id;
END;
