-- Independent, reversible visibility restrictions. Never updates or publishes profile content.
CREATE TABLE IF NOT EXISTS site_visibility (
  site_id TEXT PRIMARY KEY REFERENCES sites(id),
  hidden_fields TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(hidden_fields)),
  hidden_items TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(hidden_items)),
  hidden_aliases TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(hidden_aliases)),
  visible INTEGER NOT NULL DEFAULT 1 CHECK(visible IN (0,1)),
  listed INTEGER NOT NULL DEFAULT 1 CHECK(listed IN (0,1)),
  indexable INTEGER NOT NULL DEFAULT 1 CHECK(indexable IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  updated_at INTEGER NOT NULL,
  updated_by INTEGER NOT NULL REFERENCES users(id)
);
