PRAGMA foreign_keys=ON;

-- SQLite executes same-event triggers in reverse creation order. This trigger is deliberately
-- created after 0008 so it runs before the older dns_names_before_proxy_handover trigger.
-- It claims only an active, proxy-specific reservation; all statements are part of the
-- handover UPDATE transaction, so a collision rolls the status change and reservation update back.
CREATE TRIGGER IF NOT EXISTS dns_names_claim_proxy_reservation_before_handover
BEFORE UPDATE OF status ON handovers
WHEN OLD.status='pending' AND NEW.status='accepted' AND NEW.accepted_by IS NOT NULL
  AND EXISTS(
    SELECT 1
    FROM proxy_sites p
    JOIN reserved_names r ON r.name=p.pending_name
    WHERE p.site_id=NEW.site_id
      AND p.pending_name IS NOT NULL
      AND r.kind='proxy_pending'
      AND r.active=1
  )
BEGIN
  -- Deactivate the temporary reservation before inserting so the existing 0008 policy guard
  -- continues to be authoritative for every normal reservation while accepting this handover.
  UPDATE reserved_names
  SET active=0
  WHERE name=(SELECT pending_name FROM proxy_sites WHERE site_id=NEW.site_id)
    AND kind='proxy_pending'
    AND active=1;

  -- Do not use OR IGNORE: an unexpected authoritative-name collision must abort the handover.
  -- dns_names permits DNS-valid internal consecutive hyphens, unlike the preserved legacy names table.
  INSERT INTO dns_names(name,owner_id,site_id,created_at)
  SELECT pending_name,NEW.accepted_by,NEW.site_id,NEW.accepted_at
  FROM proxy_sites
  WHERE site_id=NEW.site_id
    AND pending_name IS NOT NULL;

  -- The legacy names row is intentionally neither replaced nor deleted. This explicit event
  -- records the authoritative claim even when no legacy names row can exist for a -- label.
  INSERT OR IGNORE INTO dns_name_events(id,name,site_id,old_owner_id,new_owner_id,event,created_at)
  SELECT 'proxy-name-claim-'||NEW.id,pending_name,NEW.site_id,NULL,NEW.accepted_by,
         'proxy_reservation_claimed',NEW.accepted_at
  FROM proxy_sites
  WHERE site_id=NEW.site_id
    AND pending_name IS NOT NULL;

  -- The older 0008 BEFORE trigger and legacy 0003 AFTER trigger now see NULL and therefore do
  -- not try to write the restricted historical names registry. Historical rows remain intact.
  UPDATE proxy_sites
  SET pending_name=NULL
  WHERE site_id=NEW.site_id
    AND pending_name IS NOT NULL;
END;

-- At most one transfer can be awaiting recipient acceptance or administrator decision for a name.
-- This intentionally fails migration application if historic duplicate active transfers exist;
-- no human transfer is rewritten, cancelled, or otherwise silently mutated.
CREATE UNIQUE INDEX IF NOT EXISTS idx_transfers_one_active_name
  ON transfers(name)
  WHERE status IN ('pending','accepted');
