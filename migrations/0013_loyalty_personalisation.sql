-- Phase 5: private member personalisation and daily loyalty. No public profile fields are added.
CREATE TABLE IF NOT EXISTS member_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  gender TEXT NOT NULL DEFAULT 'prefer_not_to_say' CHECK(gender IN ('male','female','prefer_not_to_say')),
  age_band TEXT NOT NULL DEFAULT 'prefer_not_to_say' CHECK(age_band IN ('student','early_career','established','expert','prefer_not_to_say')),
  seasonal_theme_enabled INTEGER NOT NULL DEFAULT 1 CHECK(seasonal_theme_enabled IN (0,1)),
  seasonal_notices_enabled INTEGER NOT NULL DEFAULT 0 CHECK(seasonal_notices_enabled IN (0,1)),
  badges_enabled INTEGER NOT NULL DEFAULT 1 CHECK(badges_enabled IN (0,1)),
  female_privacy_preset INTEGER NOT NULL DEFAULT 0 CHECK(female_privacy_preset IN (0,1)),
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO member_preferences(user_id,updated_at)
SELECT id,created_at FROM users;

CREATE TRIGGER IF NOT EXISTS member_preferences_on_user
AFTER INSERT ON users
BEGIN
  INSERT OR IGNORE INTO member_preferences(user_id,updated_at) VALUES(NEW.id,NEW.created_at);
END;

CREATE TABLE IF NOT EXISTS loyalty_daily_activities (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  activity_day TEXT NOT NULL,
  challenge_kind TEXT NOT NULL CHECK(challenge_kind IN ('memory','focus','speed')),
  answer_correct INTEGER NOT NULL CHECK(answer_correct IN (0,1)),
  reward_points INTEGER NOT NULL DEFAULT 0 CHECK(reward_points IN (0,25)),
  badge TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE(user_id,activity_day)
);
CREATE INDEX IF NOT EXISTS idx_loyalty_daily_user ON loyalty_daily_activities(user_id,activity_day DESC);

CREATE TABLE IF NOT EXISTS loyalty_notification_consents (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  status TEXT NOT NULL CHECK(status IN ('granted','withdrawn')),
  granted_at INTEGER,
  withdrawn_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS occasion_notices (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  occasion TEXT NOT NULL CHECK(occasion IN ('eid_al_fitr','eid_al_adha','national_day','founding_day')),
  occasion_year INTEGER NOT NULL,
  notification_id TEXT UNIQUE,
  notified_at INTEGER,
  email_status TEXT NOT NULL DEFAULT 'pending' CHECK(email_status IN ('pending','resend','cloudflare_email','unavailable')),
  created_at INTEGER NOT NULL,
  UNIQUE(user_id,occasion,occasion_year)
);
CREATE INDEX IF NOT EXISTS idx_occasion_notices_member ON occasion_notices(user_id,occasion_year DESC);


CREATE TABLE IF NOT EXISTS competition_entries (
  id TEXT PRIMARY KEY,
  competition_key TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'entered' CHECK(status IN ('entered','winner','not_selected')),
  decided_by INTEGER REFERENCES users(id),
  decided_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(competition_key,user_id)
);
CREATE INDEX IF NOT EXISTS idx_competition_entries_key ON competition_entries(competition_key,status,created_at);
