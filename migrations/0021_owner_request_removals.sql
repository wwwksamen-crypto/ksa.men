CREATE TABLE IF NOT EXISTS owner_request_removals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('review','membership')),
  request_id TEXT NOT NULL,
  actor_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000),
  previous_status TEXT NOT NULL,
  before_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(kind,request_id)
);
CREATE INDEX IF NOT EXISTS idx_owner_request_removals_time ON owner_request_removals(created_at DESC);
CREATE TRIGGER IF NOT EXISTS owner_request_removals_owner_guard BEFORE INSERT ON owner_request_removals BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_id AND role='owner' AND status='active') THEN RAISE(ABORT,'owner_required') END;
  SELECT CASE WHEN NEW.kind='review' AND NOT EXISTS(SELECT 1 FROM reviews WHERE id=NEW.request_id) THEN RAISE(ABORT,'request_missing') END;
  SELECT CASE WHEN NEW.kind='membership' AND NOT EXISTS(SELECT 1 FROM subscription_requests WHERE id=NEW.request_id) THEN RAISE(ABORT,'request_missing') END;
END;
CREATE TRIGGER IF NOT EXISTS owner_request_removals_immutable BEFORE UPDATE ON owner_request_removals BEGIN
  SELECT RAISE(ABORT,'request_removal_immutable');
END;
CREATE TRIGGER IF NOT EXISTS removed_review_no_approval BEFORE INSERT ON review_decisions
WHEN NEW.status='approved' AND EXISTS(SELECT 1 FROM owner_request_removals WHERE kind='review' AND request_id=NEW.review_id) BEGIN
  SELECT RAISE(ABORT,'request_removed');
END;
CREATE TRIGGER IF NOT EXISTS removed_membership_no_approval BEFORE UPDATE OF status ON subscription_requests
WHEN NEW.status='approved' AND OLD.status<>'approved' AND EXISTS(SELECT 1 FROM owner_request_removals WHERE kind='membership' AND request_id=NEW.id) BEGIN
  SELECT RAISE(ABORT,'request_removed');
END;
