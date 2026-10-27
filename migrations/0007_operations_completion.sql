PRAGMA foreign_keys=ON;

-- `reviews` has immutable legacy approval triggers that also require the submitted
-- draft to remain the newest draft. Keep that historical structure intact and
-- store all new decisions in a separate, one-time decision record. The triggers
-- below publish the immutable review snapshot only when its published base is
-- still current; a newer editable draft is intentionally not part of that CAS.
CREATE TABLE IF NOT EXISTS review_decisions (
  review_id TEXT PRIMARY KEY REFERENCES reviews(id),
  status TEXT NOT NULL CHECK(status IN ('approved','rejected')),
  reviewer_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL DEFAULT '',
  decided_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_review_decisions_status
  ON review_decisions(status, decided_at);
CREATE INDEX IF NOT EXISTS idx_review_decisions_reviewer
  ON review_decisions(reviewer_id, decided_at);

CREATE TRIGGER IF NOT EXISTS review_decisions_pending_review
BEFORE INSERT ON review_decisions
WHEN NOT EXISTS(
  SELECT 1 FROM reviews r WHERE r.id=NEW.review_id AND r.status='pending'
) OR EXISTS(
  SELECT 1 FROM review_events e WHERE e.review_id=NEW.review_id
)
BEGIN
  SELECT RAISE(ABORT,'A decision requires one pending review without a prior event');
END;

CREATE TRIGGER IF NOT EXISTS review_decisions_rejected_reason
BEFORE INSERT ON review_decisions
WHEN NEW.status='rejected' AND length(trim(NEW.reason))=0
BEGIN
  SELECT RAISE(ABORT,'A rejected review requires a reason');
END;

CREATE TRIGGER IF NOT EXISTS review_decisions_approval_base_cas
BEFORE INSERT ON review_decisions
WHEN NEW.status='approved' AND NOT EXISTS(
  SELECT 1
  FROM reviews r JOIN sites s ON s.id=r.site_id
  WHERE r.id=NEW.review_id
    AND s.published_version=r.base_version
    AND (s.user_id IS NOT NULL OR (s.authorization IS NOT NULL AND EXISTS(SELECT 1 FROM proxy_sites p WHERE p.site_id=s.id)))
)
BEGIN
  SELECT RAISE(ABORT,'The reviewed published base is no longer current');
END;

CREATE TRIGGER IF NOT EXISTS review_decisions_immutable
BEFORE UPDATE ON review_decisions
BEGIN
  SELECT RAISE(ABORT,'A review decision cannot be changed');
END;

CREATE TRIGGER IF NOT EXISTS review_decisions_publish_snapshot
AFTER INSERT ON review_decisions
WHEN NEW.status='approved'
BEGIN
  UPDATE sites
  SET published=(SELECT snapshot FROM reviews WHERE id=NEW.review_id),
      published_version=(SELECT draft_version FROM reviews WHERE id=NEW.review_id),
      status='published',
      updated_at=NEW.decided_at
  WHERE id=(SELECT site_id FROM reviews WHERE id=NEW.review_id)
    AND published_version=(SELECT base_version FROM reviews WHERE id=NEW.review_id)
    AND (user_id IS NOT NULL OR (authorization IS NOT NULL AND EXISTS(SELECT 1 FROM proxy_sites p WHERE p.site_id=sites.id)));
  SELECT CASE WHEN changes()=0 THEN RAISE(ABORT,'The reviewed published base changed before publication') END;
END;

CREATE TRIGGER IF NOT EXISTS review_decisions_record_event
AFTER INSERT ON review_decisions
BEGIN
  INSERT INTO review_events(id,review_id,site_id,reviewer_id,decision,reason,created_at)
  SELECT 'review-event-decision-'||NEW.review_id,r.id,r.site_id,NEW.reviewer_id,NEW.status,NEW.reason,NEW.decided_at
  FROM reviews r WHERE r.id=NEW.review_id;
END;

-- A reversal is retained as evidence and deactivates exactly the subscription
-- provenance created for that approved payment. It never infers an interval
-- from users.entitlement_until; a missing or already revoked source aborts.
CREATE TRIGGER IF NOT EXISTS payment_reversal_revoke_subscription_source
AFTER INSERT ON payment_reversals
BEGIN
  UPDATE entitlement_sources
  SET revoked_at=NEW.created_at
  WHERE source_kind='subscription'
    AND reference='subscription-'||NEW.payment_id
    AND user_id=(SELECT user_id FROM payments WHERE id=NEW.payment_id)
    AND revoked_at IS NULL;
  SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'The payment subscription source cannot be revoked') END;
END;

-- A proxy site's media may be supplied by its authorized creating operator.
-- Track only media attached to an unaccepted proxy site, so an accepted handover
-- can transfer those media records with the site while preserving the original R2 object.
CREATE TABLE IF NOT EXISTS proxy_media (
  site_id TEXT NOT NULL REFERENCES sites(id),
  media_id TEXT NOT NULL REFERENCES media(id),
  creator_id INTEGER NOT NULL REFERENCES users(id),
  accepted_by INTEGER REFERENCES users(id),
  transferred_at INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(site_id, media_id),
  UNIQUE(media_id)
);

CREATE INDEX IF NOT EXISTS idx_proxy_media_site
  ON proxy_media(site_id, created_at);

CREATE TRIGGER IF NOT EXISTS proxy_media_track_insert
AFTER INSERT ON media
WHEN NEW.site_id IS NOT NULL
  AND NEW.purpose IN ('photo','cover','skill','work')
  AND EXISTS(
    SELECT 1 FROM proxy_sites p
    WHERE p.site_id=NEW.site_id
      AND p.creator_id=NEW.owner_id
      AND p.consented_at IS NULL
  )
BEGIN
  INSERT OR IGNORE INTO proxy_media(site_id,media_id,creator_id,created_at)
  VALUES(NEW.site_id,NEW.id,NEW.owner_id,NEW.created_at);
END;

CREATE TRIGGER IF NOT EXISTS proxy_media_track_attachment
AFTER UPDATE OF site_id ON media
WHEN NEW.site_id IS NOT NULL
  AND NEW.purpose IN ('photo','cover','skill','work')
  AND EXISTS(
    SELECT 1 FROM proxy_sites p
    WHERE p.site_id=NEW.site_id
      AND p.creator_id=NEW.owner_id
      AND p.consented_at IS NULL
  )
BEGIN
  INSERT OR IGNORE INTO proxy_media(site_id,media_id,creator_id,created_at)
  VALUES(NEW.site_id,NEW.id,NEW.owner_id,NEW.created_at);
END;

CREATE TRIGGER IF NOT EXISTS proxy_handover_transfer_media
AFTER UPDATE OF status ON handovers
WHEN OLD.status='pending' AND NEW.status='accepted' AND NEW.accepted_by IS NOT NULL
BEGIN
  UPDATE media
  SET owner_id=NEW.accepted_by
  WHERE EXISTS(
    SELECT 1 FROM proxy_media pm
    WHERE pm.site_id=NEW.site_id
      AND pm.media_id=media.id
      AND pm.creator_id=media.owner_id
  );

  UPDATE proxy_media
  SET accepted_by=NEW.accepted_by,
      transferred_at=NEW.accepted_at
  WHERE site_id=NEW.site_id
    AND transferred_at IS NULL;
END;
