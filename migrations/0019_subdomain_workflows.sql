PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS subdomain_change_requests (
 id TEXT PRIMARY KEY,
 site_id TEXT NOT NULL REFERENCES sites(id),
 user_id INTEGER NOT NULL REFERENCES users(id),
 requested_by INTEGER NOT NULL REFERENCES users(id),
 old_name TEXT NOT NULL,
 new_name TEXT NOT NULL,
 requested_version INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
 created_at INTEGER NOT NULL,
 decided_at INTEGER,
 reviewer_id INTEGER REFERENCES users(id),
 applied_review_id TEXT REFERENCES reviews(id),
 CHECK(old_name<>new_name),
 CHECK(new_name=lower(new_name) AND length(new_name) BETWEEN 1 AND 63 AND new_name NOT GLOB '*[^a-z0-9-]*' AND new_name NOT GLOB '-*' AND new_name NOT GLOB '*-')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subdomain_pending_name ON subdomain_change_requests(new_name) WHERE status='pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_subdomain_pending_site ON subdomain_change_requests(site_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_subdomain_site_history ON subdomain_change_requests(site_id,created_at);
CREATE TABLE IF NOT EXISTS owner_subdomain_redirects (
 name TEXT PRIMARY KEY REFERENCES dns_names(name),
 target_url TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_by INTEGER NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 CHECK(substr(target_url,1,8)='https://' AND length(target_url) BETWEEN 9 AND 2048)
);
CREATE TRIGGER IF NOT EXISTS subdomain_request_valid BEFORE INSERT ON subdomain_change_requests
WHEN NEW.status='pending'
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM dns_names n JOIN sites s ON s.id=n.site_id WHERE n.name=NEW.old_name AND n.site_id=NEW.site_id AND n.owner_id=NEW.user_id AND s.user_id=NEW.user_id AND s.draft_version=NEW.requested_version) THEN RAISE(ABORT,'Changed profile name or revision') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM dns_names WHERE name=NEW.new_name) OR EXISTS(SELECT 1 FROM reserved_names WHERE name=NEW.new_name AND active=1) THEN RAISE(ABORT,'Name unavailable') END;
END;
CREATE TRIGGER IF NOT EXISTS dns_names_pending_claim_insert BEFORE INSERT ON dns_names
WHEN EXISTS(SELECT 1 FROM subdomain_change_requests WHERE new_name=NEW.name AND status='pending')
BEGIN SELECT RAISE(ABORT,'Name pending publication'); END;
CREATE TRIGGER IF NOT EXISTS dns_names_pending_claim_update BEFORE UPDATE OF name ON dns_names
WHEN OLD.name<>NEW.name
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM reserved_names WHERE name=NEW.name AND active=1) THEN RAISE(ABORT,'Reserved profile name') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM subdomain_change_requests WHERE new_name=NEW.name AND status='pending' AND (site_id IS NOT NEW.site_id OR user_id<>NEW.owner_id)) THEN RAISE(ABORT,'Name pending publication') END;
END;
CREATE TRIGGER IF NOT EXISTS owner_redirect_registry_guard BEFORE INSERT ON owner_subdomain_redirects
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM dns_names n JOIN users u ON u.id=n.owner_id WHERE n.name=NEW.name AND n.site_id IS NULL AND n.owner_id=NEW.created_by AND u.role='owner' AND u.status='active') THEN RAISE(ABORT,'Only owner may reserve redirect names') END;
END;
CREATE TRIGGER IF NOT EXISTS owner_redirect_prevent_attachment BEFORE UPDATE OF name,site_id,owner_id ON dns_names
WHEN EXISTS(SELECT 1 FROM owner_subdomain_redirects WHERE name=OLD.name)
 AND (OLD.name<>NEW.name OR NEW.site_id IS NOT NULL OR OLD.owner_id<>NEW.owner_id)
BEGIN SELECT RAISE(ABORT,'Redirect reservation cannot attach to a profile'); END;
CREATE TRIGGER IF NOT EXISTS subdomain_name_publication AFTER INSERT ON review_decisions
WHEN NEW.status='approved' AND EXISTS(
 SELECT 1 FROM subdomain_change_requests q JOIN reviews r ON r.site_id=q.site_id
 WHERE r.id=NEW.review_id AND r.kind='content' AND q.status='pending' AND q.requested_version<=r.draft_version)
BEGIN
 INSERT INTO dns_name_events(id,name,site_id,old_owner_id,new_owner_id,event,created_at)
 SELECT 'subdomain-approval-'||q.id,q.old_name,q.site_id,q.user_id,q.user_id,'profile_name_released',NEW.decided_at
 FROM subdomain_change_requests q JOIN reviews r ON r.site_id=q.site_id WHERE r.id=NEW.review_id AND q.status='pending' AND q.requested_version<=r.draft_version;
 UPDATE dns_names SET name=(SELECT q.new_name FROM subdomain_change_requests q WHERE q.site_id=dns_names.site_id AND q.status='pending')
 WHERE EXISTS(SELECT 1 FROM subdomain_change_requests q JOIN reviews r ON r.site_id=q.site_id WHERE r.id=NEW.review_id AND q.site_id=dns_names.site_id AND q.old_name=dns_names.name AND q.user_id=dns_names.owner_id AND q.status='pending' AND q.requested_version<=r.draft_version);
 SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'Profile name changed before approval') END;
 UPDATE subdomain_change_requests SET status='approved',decided_at=NEW.decided_at,reviewer_id=NEW.reviewer_id,applied_review_id=NEW.review_id
 WHERE status='pending' AND site_id=(SELECT site_id FROM reviews WHERE id=NEW.review_id) AND requested_version<=(SELECT draft_version FROM reviews WHERE id=NEW.review_id);
END;
CREATE TRIGGER IF NOT EXISTS subdomain_name_rejection AFTER INSERT ON review_decisions
WHEN NEW.status='rejected'
BEGIN
 UPDATE subdomain_change_requests SET status='rejected',decided_at=NEW.decided_at,reviewer_id=NEW.reviewer_id,applied_review_id=NEW.review_id
 WHERE status='pending' AND site_id=(SELECT site_id FROM reviews WHERE id=NEW.review_id AND kind='content') AND requested_version<=(SELECT draft_version FROM reviews WHERE id=NEW.review_id);
END;

CREATE TRIGGER IF NOT EXISTS reserved_names_pending_insert BEFORE INSERT ON reserved_names
WHEN NEW.active=1 AND EXISTS(SELECT 1 FROM subdomain_change_requests WHERE new_name=NEW.name AND status='pending')
BEGIN SELECT RAISE(ABORT,'Name pending publication'); END;
CREATE TRIGGER IF NOT EXISTS reserved_names_pending_update BEFORE UPDATE OF name,active ON reserved_names
WHEN NEW.active=1 AND EXISTS(SELECT 1 FROM subdomain_change_requests WHERE new_name=NEW.name AND status='pending')
BEGIN SELECT RAISE(ABORT,'Name pending publication'); END;
CREATE TRIGGER IF NOT EXISTS owner_redirect_cycle_insert BEFORE INSERT ON owner_subdomain_redirects WHEN NEW.active=1
BEGIN
 SELECT CASE WHEN EXISTS(
  WITH RECURSIVE chain(url,depth) AS (
   SELECT NEW.target_url,0 UNION ALL
   SELECT r.target_url,c.depth+1 FROM chain c JOIN owner_subdomain_redirects r ON r.active=1 AND (c.url='https://'||r.name||'.ksa.men/' OR c.url LIKE 'https://'||r.name||'.ksa.men/?%' OR c.url LIKE 'https://'||r.name||'.ksa.men/#%') WHERE c.depth<40
  ) SELECT 1 FROM chain WHERE url='https://'||NEW.name||'.ksa.men/' OR url LIKE 'https://'||NEW.name||'.ksa.men/?%' OR url LIKE 'https://'||NEW.name||'.ksa.men/#%' OR depth=40
 ) THEN RAISE(ABORT,'Redirect cycle') END;
END;
CREATE TRIGGER IF NOT EXISTS owner_redirect_cycle_update BEFORE UPDATE OF target_url,active ON owner_subdomain_redirects WHEN NEW.active=1
BEGIN
 SELECT CASE WHEN EXISTS(
  WITH RECURSIVE chain(url,depth) AS (
   SELECT NEW.target_url,0 UNION ALL
   SELECT r.target_url,c.depth+1 FROM chain c JOIN owner_subdomain_redirects r ON r.active=1 AND (c.url='https://'||r.name||'.ksa.men/' OR c.url LIKE 'https://'||r.name||'.ksa.men/?%' OR c.url LIKE 'https://'||r.name||'.ksa.men/#%') WHERE c.depth<40
  ) SELECT 1 FROM chain WHERE url='https://'||NEW.name||'.ksa.men/' OR url LIKE 'https://'||NEW.name||'.ksa.men/?%' OR url LIKE 'https://'||NEW.name||'.ksa.men/#%' OR depth=40
 ) THEN RAISE(ABORT,'Redirect cycle') END;
END;
