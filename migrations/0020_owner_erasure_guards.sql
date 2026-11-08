PRAGMA foreign_keys=ON;
-- Additive guards only; deployment never erases an existing account or site.
CREATE TRIGGER IF NOT EXISTS owner_erasure_hold_guard
BEFORE INSERT ON deleted_tombstones
WHEN NEW.source='owner-erasure' AND (
 EXISTS(SELECT 1 FROM retention_holds h WHERE h.status='active' AND (
  (NEW.resource_type='account' AND (h.user_id=CAST(NEW.resource_id AS INTEGER) OR (h.resource_type='account' AND h.resource_id=NEW.resource_id))) OR
  (NEW.resource_type='media' AND (h.resource_id=NEW.resource_id OR h.user_id=(SELECT owner_id FROM media WHERE id=NEW.resource_id))) OR
  (NEW.resource_type='site' AND (h.resource_id=NEW.resource_id OR h.user_id=(SELECT user_id FROM sites WHERE id=NEW.resource_id)))
 )) OR (NEW.resource_type='account' AND EXISTS(SELECT 1 FROM users WHERE id=CAST(NEW.resource_id AS INTEGER) AND role='owner'))
)
BEGIN SELECT RAISE(ABORT,'Protected resource cannot be erased'); END;
CREATE TRIGGER IF NOT EXISTS erased_account_no_reactivation
BEFORE UPDATE ON users
WHEN EXISTS(SELECT 1 FROM deleted_tombstones t WHERE t.resource_type='account' AND t.resource_id=CAST(OLD.id AS TEXT) AND t.source='owner-erasure')
 AND (NEW.status<>'deleted' OR NEW.pin_hash IS NOT NULL OR NEW.role<>'user' OR NEW.whatsapp<>'' OR NEW.name<>'حساب محذوف' OR NEW.email<>'erased-'||OLD.id||'@deleted.ksa.men')
BEGIN SELECT RAISE(ABORT,'Erased account cannot be reactivated'); END;
CREATE TRIGGER IF NOT EXISTS erased_site_no_republication
BEFORE UPDATE ON sites
WHEN EXISTS(SELECT 1 FROM deleted_tombstones t WHERE t.resource_type='site' AND t.resource_id=OLD.id AND t.source='owner-erasure')
 AND (NEW.status<>'deleted' OR NEW.draft<>'{}' OR NEW.published IS NOT NULL OR NEW.lock_hash IS NOT NULL OR NEW.searchable<>0 OR NEW.allow_contact<>0)
BEGIN SELECT RAISE(ABORT,'Erased site cannot be republished'); END;
