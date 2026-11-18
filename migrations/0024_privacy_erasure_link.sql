-- Stage 3: explicit association with an ALREADY committed scoped operation.
-- No runtime work, erasure, policy default, account or balance change.
CREATE TABLE IF NOT EXISTS privacy_erasure_links (
  request_id TEXT PRIMARY KEY REFERENCES privacy_requests(id),
  deletion_request_id TEXT NOT NULL UNIQUE REFERENCES deletion_requests(id),
  scope TEXT NOT NULL CHECK(scope IN ('account','account_only','site')),
  resource_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  linked_by INTEGER NOT NULL,
  linked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_privacy_erasure_operation ON privacy_erasure_links(deletion_request_id);
CREATE TRIGGER IF NOT EXISTS privacy_erasure_link_immutable
 BEFORE UPDATE ON privacy_erasure_links BEGIN SELECT RAISE(ABORT,'Erasure association cannot be replaced'); END;
