PRAGMA foreign_keys=ON;

-- A user has one personal profile site; additional names may point at that same site.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_one_primary_user
  ON sites(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_names_owner ON names(owner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transfers_recipient ON transfers(to_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_handovers_target ON handovers(target_email, status, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_site_event ON analytics(site_id, event, created_at);

-- Only one outstanding review may represent a draft version. Rejected versions may be edited and resubmitted.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_pending_site_version
  ON reviews(site_id, draft_version) WHERE status='pending';

-- Keep submitted review evidence immutable while allowing an operator to change its decision fields.
CREATE TRIGGER IF NOT EXISTS reviews_snapshot_immutable
BEFORE UPDATE OF snapshot, draft_version, base_version, site_id, user_id ON reviews
BEGIN
  SELECT RAISE(ABORT, 'Submitted review snapshots are immutable');
END;

-- Guard names at the database boundary as well as in the API, closing reservation races.
CREATE TRIGGER IF NOT EXISTS names_reservation_guard
BEFORE INSERT ON names
BEGIN
  SELECT CASE WHEN NEW.name <> lower(NEW.name)
    OR length(NEW.name) < 1 OR length(NEW.name) > 63
    OR NEW.name GLOB '*[^a-z0-9-]*'
    OR NEW.name GLOB '-*' OR NEW.name GLOB '*-'
    OR NEW.name GLOB '*--*'
    THEN RAISE(ABORT, 'Invalid profile name') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM reserved_names WHERE name=NEW.name AND active=1
  ) THEN RAISE(ABORT, 'Reserved profile name') END;
END;

INSERT OR IGNORE INTO reserved_names(name,kind,reason,active) VALUES
 ('www','technical','عنوان الويب الرئيسي',1),
 ('app','technical','تطبيق المنصة',1),
 ('admin','technical','إدارة المنصة',1),
 ('api','technical','واجهة المنصة البرمجية',1),
 ('auth','technical','المصادقة',1),
 ('mail','technical','خدمة البريد',1),
 ('smtp','technical','خدمة البريد',1),
 ('imap','technical','خدمة البريد',1),
 ('pop','technical','خدمة البريد',1),
 ('support','technical','الدعم',1),
 ('status','technical','حالة المنصة',1),
 ('static','technical','الملفات الثابتة',1),
 ('assets','technical','أصول المنصة',1),
 ('cdn','technical','توزيع المحتوى',1),
 ('media','technical','الوسائط',1),
 ('files','technical','الملفات',1),
 ('upload','technical','الرفع',1),
 ('uploads','technical','الرفع',1),
 ('webhooks','technical','الويب هوكس',1),
 ('dev','technical','بيئة التطوير',1),
 ('test','technical','بيئة الاختبار',1),
 ('staging','technical','بيئة التجهيز',1),
 ('preview','technical','بيئة المعاينة',1);

-- The policy JSON is deliberately explicit: core service enforcement reads the same catalog.
INSERT OR IGNORE INTO services(key,name_ar,name_en,enabled,premium,policy) VALUES
 ('site_lock','قفل الموقع','Site lock',1,1,'{"trial":true,"subscription":true,"grant":true,"points":true}'),
 ('quick_link','رابط التعارف السريع','Quick introduction link',1,1,'{"trial":true,"subscription":true,"grant":true,"points":true}'),
 ('analytics','بصمة الحضور الرقمي','Digital presence analytics',1,1,'{"trial":true,"subscription":true,"grant":true,"points":true}'),
 ('identity_quality','لوحة جودة الهوية','Identity quality dashboard',1,1,'{"trial":true,"subscription":true,"grant":true,"points":true}'),
 ('digital_card','البطاقة الذكية','Smart digital card',1,1,'{"trial":true,"subscription":true,"grant":true,"points":true}'),
 ('vcard','بطاقة الاتصال','vCard export',1,1,'{"trial":true,"subscription":true,"grant":true,"points":true}'),
 ('profile_pdf','الملف التعريفي PDF','Profile PDF export',1,1,'{"trial":true,"subscription":true,"grant":true,"points":true}'),
 ('ats_pdf','السيرة الذاتية ATS','ATS resume export',1,1,'{"trial":true,"subscription":true,"grant":true,"points":true}'),
 ('radar','رادار المعلومة المهنية','Professional information radar',1,1,'{"trial":true,"subscription":true,"grant":true,"points":true}');

-- The official launch seed intentionally carries no bank-name assertion.
INSERT INTO settings(key,value) VALUES
 ('bank','{"enabled":true,"beneficiary":"شركة رجال الوطن","iban":"SA5380000296608010947219","account":"296000010006080947219"}')
ON CONFLICT(key) DO UPDATE SET value=excluded.value;

-- A private receipt can substantiate exactly one payment request for its owner.
-- This closes concurrent submit/retry races without changing or deleting prior records.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_user_receipt
  ON payments(user_id,receipt_id) WHERE receipt_id IS NOT NULL;
