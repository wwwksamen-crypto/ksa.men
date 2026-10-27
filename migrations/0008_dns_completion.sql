PRAGMA foreign_keys=ON;
-- The historical names table and its immutable deployed guard are preserved.
-- dns_names is the authoritative registry, allowing all DNS-valid labels, including --.
CREATE TABLE IF NOT EXISTS dns_names (
 name TEXT PRIMARY KEY,
 owner_id INTEGER NOT NULL REFERENCES users(id),
 site_id TEXT REFERENCES sites(id),
 created_at INTEGER NOT NULL,
 CHECK(name=lower(name) AND length(name) BETWEEN 1 AND 63),
 CHECK(name NOT GLOB '*[^a-z0-9-]*' AND name NOT GLOB '-*' AND name NOT GLOB '*-')
);
INSERT OR IGNORE INTO dns_names(name,owner_id,site_id,created_at)
SELECT name,owner_id,site_id,created_at FROM names;
CREATE INDEX IF NOT EXISTS idx_dns_names_owner ON dns_names(owner_id,created_at);
CREATE INDEX IF NOT EXISTS idx_dns_names_site ON dns_names(site_id);
CREATE TRIGGER IF NOT EXISTS dns_names_policy_guard
BEFORE INSERT ON dns_names
WHEN EXISTS(SELECT 1 FROM reserved_names WHERE name=NEW.name AND active=1)
BEGIN
 SELECT RAISE(ABORT,'Reserved profile name');
END;
CREATE TABLE IF NOT EXISTS dns_name_events (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 site_id TEXT,
 old_owner_id INTEGER,
 new_owner_id INTEGER,
 event TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
-- Preserve the legacy pending name as an explicit event, so the old trigger does not
-- attempt to insert a valid -- label into the old constrained registry during handover.
CREATE TRIGGER IF NOT EXISTS dns_names_before_proxy_handover
BEFORE UPDATE OF status ON handovers
WHEN OLD.status='pending' AND NEW.status='accepted' AND NEW.accepted_by IS NOT NULL
BEGIN
 INSERT OR IGNORE INTO dns_name_events(id,name,site_id,old_owner_id,new_owner_id,event,created_at)
 SELECT 'handover-name-'||NEW.id,n.name,NEW.site_id,n.owner_id,NEW.accepted_by,'verified_site_handover',NEW.accepted_at
 FROM dns_names n WHERE n.site_id=NEW.site_id;
 UPDATE proxy_sites SET pending_name=NULL
 WHERE site_id=NEW.site_id AND pending_name IS NOT NULL
   AND EXISTS(SELECT 1 FROM dns_names WHERE site_id=NEW.site_id AND name=proxy_sites.pending_name);
END;
CREATE TRIGGER IF NOT EXISTS dns_names_after_proxy_handover
AFTER UPDATE OF status ON handovers
WHEN OLD.status='pending' AND NEW.status='accepted' AND NEW.accepted_by IS NOT NULL
BEGIN
 UPDATE dns_names SET owner_id=NEW.accepted_by WHERE site_id=NEW.site_id;
END;
CREATE TRIGGER IF NOT EXISTS dns_names_transfer_audit
AFTER UPDATE OF owner_id ON dns_names
WHEN OLD.owner_id<>NEW.owner_id
BEGIN
 INSERT INTO dns_name_events(id,name,site_id,old_owner_id,new_owner_id,event,created_at)
 VALUES('name-change-'||NEW.name||'-'||hex(randomblob(12)),NEW.name,OLD.site_id,OLD.owner_id,NEW.owner_id,'name_owner_changed',unixepoch());
END;
