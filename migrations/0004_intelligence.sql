PRAGMA foreign_keys=ON;

-- Per-application guardrail. Workers AI's included free allocation is shared across
-- the Cloudflare account; usage made by other projects is not observable here.
CREATE TABLE IF NOT EXISTS intelligence_usage (
  day_start INTEGER NOT NULL,
  service_key TEXT NOT NULL,
  characters INTEGER NOT NULL DEFAULT 0 CHECK(characters >= 0 AND characters <= 50000),
  estimated_neurons INTEGER NOT NULL DEFAULT 0 CHECK(estimated_neurons >= 0 AND estimated_neurons <= 4000),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(day_start, service_key)
);

INSERT OR IGNORE INTO settings(key,value) VALUES
  ('intelligence_translation_quota','{"model":"@cf/meta/m2m100-1.2b","cloudflareFreeDailyNeurons":10000,"applicationDailyCharacters":50000,"applicationEstimatedNeurons":4000,"scope":"Cloudflare account-wide; usage by other projects is not observable by this application."}');

INSERT OR IGNORE INTO services(key,name_ar,name_en,enabled,premium,policy) VALUES
  ('translation','ترجمة الملف التعريفي','Profile translation',1,1,'{"trial":true,"subscription":true,"grant":true,"points":true}');

-- Feed endpoints were directly checked on 2026-10-27: each returned a publisher XML/RSS feed.
-- url is the publisher feed URL (not an inferred article URL).
INSERT OR IGNORE INTO radar_sources(id,name,url,category,region,enabled) VALUES
  ('hbr-arabic','Harvard Business Review Arabia','https://hbrarabic.com/feed/','management','MENA',1),
  ('wamda','Wamda','https://www.wamda.com/feed','entrepreneurship','MENA',1),
  ('forbes-middle-east','Forbes Middle East','https://www.forbesmiddleeast.com/feed','business','MENA',1);

CREATE INDEX IF NOT EXISTS idx_intelligence_usage_service_day
  ON intelligence_usage(service_key, day_start);
CREATE INDEX IF NOT EXISTS idx_radar_source_fetch
  ON radar_sources(enabled, last_fetched);
