PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS review_events (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL UNIQUE REFERENCES reviews(id),
  site_id TEXT NOT NULL REFERENCES sites(id),
  reviewer_id INTEGER NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_reversals (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  justification TEXT NOT NULL,
  entitlement_before INTEGER NOT NULL,
  entitlement_after INTEGER NOT NULL,
  referral_recovered INTEGER NOT NULL DEFAULT 0,
  referral_outstanding INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS entitlement_adjustments (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  payment_id TEXT REFERENCES payments(id),
  kind TEXT NOT NULL,
  before_at INTEGER NOT NULL,
  after_at INTEGER NOT NULL,
  reason TEXT NOT NULL,
  actor_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS proxy_sites (
  site_id TEXT PRIMARY KEY REFERENCES sites(id),
  pending_name TEXT,
  target_email TEXT NOT NULL,
  authorization TEXT NOT NULL,
  creator_id INTEGER NOT NULL REFERENCES users(id),
  consented_at INTEGER,
  accepted_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS site_custody (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  event TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id),
  owner_id INTEGER REFERENCES users(id),
  manager_id INTEGER REFERENCES users(id),
  handover_id TEXT REFERENCES handovers(id),
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_review_events_site ON review_events(site_id,created_at);
CREATE INDEX IF NOT EXISTS idx_payment_reversals_payment ON payment_reversals(payment_id);
CREATE INDEX IF NOT EXISTS idx_site_custody_site ON site_custody(site_id,created_at);
CREATE INDEX IF NOT EXISTS idx_proxy_sites_email ON proxy_sites(target_email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_requests_pending_pair
  ON contact_requests(
    CASE WHEN from_id < to_id THEN from_id ELSE to_id END,
    CASE WHEN from_id < to_id THEN to_id ELSE from_id END
  ) WHERE status='pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_active_pair
  ON conversations(
    CASE WHEN from_id < to_id THEN from_id ELSE to_id END,
    CASE WHEN from_id < to_id THEN to_id ELSE from_id END
  ) WHERE status='active';

CREATE TRIGGER IF NOT EXISTS reviews_snapshot_immutable
BEFORE UPDATE OF snapshot,draft_version,base_version,site_id,user_id ON reviews
BEGIN
  SELECT RAISE(ABORT,'Review snapshot and version metadata are immutable');
END;

CREATE TRIGGER IF NOT EXISTS reviews_decision_once
BEFORE UPDATE OF status ON reviews
WHEN OLD.status <> 'pending'
BEGIN
  SELECT RAISE(ABORT,'A review decision cannot be replaced');
END;

CREATE TRIGGER IF NOT EXISTS reviews_decision_shape
BEFORE UPDATE OF status ON reviews
WHEN NEW.status NOT IN ('approved','rejected')
  OR NEW.reviewer_id IS NULL
  OR NEW.decided_at IS NULL
BEGIN
  SELECT RAISE(ABORT,'A review requires one reviewer and one valid decision');
END;

CREATE TRIGGER IF NOT EXISTS reviews_current_version_cas
BEFORE UPDATE OF status ON reviews
WHEN OLD.status='pending' AND NEW.status='approved'
  AND NOT EXISTS(
    SELECT 1 FROM sites s
    WHERE s.id=NEW.site_id
      AND s.published_version=NEW.base_version
      AND s.draft_version=NEW.draft_version
      AND s.user_id IS NOT NULL
      AND s.status<>'proxy_pending'
  )
BEGIN
  SELECT RAISE(ABORT,'The reviewed draft version is no longer current');
END;

CREATE TRIGGER IF NOT EXISTS reviews_publish_on_approval
AFTER UPDATE OF status ON reviews
WHEN OLD.status='pending' AND NEW.status='approved'
BEGIN
  UPDATE sites
  SET published=NEW.snapshot,
      published_version=NEW.draft_version,
      status='published',
      updated_at=NEW.decided_at
  WHERE id=NEW.site_id
    AND published_version=NEW.base_version
    AND draft_version=NEW.draft_version
    AND user_id IS NOT NULL
    AND status<>'proxy_pending';
  SELECT CASE WHEN changes()=0 THEN RAISE(ABORT,'The reviewed version is no longer current or lacks accepted custody') END;
END;

CREATE TRIGGER IF NOT EXISTS payments_decision_once
BEFORE UPDATE OF status ON payments
WHEN OLD.status NOT IN ('requested','submitted')
BEGIN
  SELECT RAISE(ABORT,'A payment decision cannot be replaced');
END;

CREATE TRIGGER IF NOT EXISTS payments_decision_shape
BEFORE UPDATE OF status ON payments
WHEN NEW.status NOT IN ('approved','rejected')
  OR NEW.reviewer_id IS NULL
BEGIN
  SELECT RAISE(ABORT,'A payment requires one valid decision reviewer');
END;

CREATE TRIGGER IF NOT EXISTS proxy_handover_accepted
AFTER UPDATE OF status ON handovers
WHEN OLD.status='pending' AND NEW.status='accepted' AND NEW.accepted_by IS NOT NULL
BEGIN
  UPDATE sites
  SET user_id=NEW.accepted_by,
      status=CASE WHEN status='proxy_pending' THEN 'draft' ELSE status END,
      updated_at=NEW.accepted_at
  WHERE id=NEW.site_id;

  UPDATE proxy_sites
  SET consented_at=NEW.accepted_at,
      accepted_by=NEW.accepted_by
  WHERE site_id=NEW.site_id;

  INSERT OR IGNORE INTO names(name,owner_id,site_id,created_at)
  SELECT pending_name,NEW.accepted_by,NEW.site_id,NEW.accepted_at
  FROM proxy_sites
  WHERE site_id=NEW.site_id
    AND pending_name IS NOT NULL
    AND consented_at=NEW.accepted_at;

  UPDATE reserved_names
  SET active=0
  WHERE name=(SELECT pending_name FROM proxy_sites WHERE site_id=NEW.site_id)
    AND kind='proxy_pending';

  INSERT INTO site_custody(id,site_id,event,actor_id,owner_id,manager_id,handover_id,detail,created_at)
  SELECT 'custody-handover-'||NEW.id,NEW.site_id,'handover_accepted',NEW.creator_id,NEW.accepted_by,s.manager_id,NEW.id,'Accepted through the verified account associated with the handover email.',NEW.accepted_at
  FROM sites s
  WHERE s.id=NEW.site_id;
END;

UPDATE settings
SET value='{"mode":"open","message":"","reason":"","passwordHash":null}'
WHERE key='lock';

INSERT INTO content(slug,title_ar,title_en,body_ar,body_en,status,created_at,updated_at)
VALUES
(
  'privacy',
  'سياسة الخصوصية',
  'Privacy policy',
  'توضح هذه السياسة كيفية تعامل منصة KSA.MEN مع البيانات التي تقدمها عند إنشاء الحساب أو الموقع الشخصي أو استخدام خدمات المنصة. المالك القانوني للمنصة هو شركة رجال الوطن القابضة. واسم الشركة في الشهادة هو شركة رجال الوطن، بالرقم الموحد 7050011712، والصادرة بتاريخ 10/05/2025، وهي شركة ذات مسؤولية محدودة من شخص واحد. نجمع بيانات الحساب التي تدخلها مثل الاسم والبريد الإلكتروني ورقم التواصل، وبيانات الموقع والمسودات والمحتوى المنشور الذي تختاره، وملفات الوسائط التي ترفعها، وسجل الاستحقاقات والمعاملات غير النقدية، وطلبات الدفع وإيصالاتها الخاصة، وبيانات الجلسة والحماية وسجل التدقيق اللازم لحماية الخدمة. عند استخدام التواصل الاختياري نعالج طلبات التواصل وحالة الجلسة والرسائل النصية ضمن أطراف المحادثة فقط.\n\nنستخدم هذه البيانات لتشغيل الحساب والموقع والنطاق الفرعي، تطبيق المراجعة قبل النشر، تنفيذ الاستحقاقات ونقاط الوسط، حماية المنصة ومنع إساءة الاستخدام، دعم المستخدم، والوفاء بطلبات يختارها المستخدم. لا تنشر المنصة بيانات الاتصال أو الحقول المخفية ما لم يقرر المستخدم إظهارها في ملفه المنشور، ولا تتيح للمشرفين قراءة الرسائل الخاصة بصورة اعتيادية. قد يطلع المخول على دليل محدد في بلاغ موثق عندما يلزم لمعالجة البلاغ، ويُسجل ذلك.\n\nتحفظ البيانات لدى البنية التشغيلية اللازمة لتقديم الخدمة، وتبقى الإيصالات والوسائط الخاصة محمية، ولا تحتوي المنصة على معالجة لبيانات بطاقات مصرفية. يستطيع المستخدم تعديل بياناته العامة وإيقاف استقبال طلبات التواصل وطلب حذف الحساب وفق مدد الاحتفاظ والالتزامات النظامية المطبقة. هذه سياسة تشغيلية يجب مراجعتها من مختص قبل الإطلاق العام.',
  'This policy explains how KSA.MEN handles data supplied when an account or personal site is created or when platform services are used. The platform’s legal owner is Rijal Al Watan Holding Company (شركة رجال الوطن القابضة). The certificate company name is Rijal Al Watan Company (شركة رجال الوطن), Unified No. 7050011712, issued on 10/05/2025; it is a single-person limited liability company. We process account details entered by the user, such as name, email and contact number; site drafts and content selected for publication; uploaded media; entitlement and non-cash point records; payment requests and their private receipts; and session, security and audit information needed to protect the service. When optional contact is used, we process contact requests, session state and text messages only for the people involved in that conversation.\n\nWe use this information to operate the account, personal site and subdomain; apply review before publication; provide entitlements and Mid Points; protect the platform and prevent abuse; provide support; and carry out requests chosen by the user. Contact details and hidden fields are not published unless the user chooses to display them in a published profile. Administrators do not have ordinary access to private messages. An authorized person may view specifically reported evidence when needed to address a documented report, and that access is logged.\n\nData is held in the operational infrastructure needed to provide the service. Private receipts and media remain protected, and the platform does not process payment-card data. Users can update their public data, stop receiving contact requests and request account removal subject to stated retention periods and applicable obligations. This is an operational policy that requires specialist review before public launch.',
  'published',
  0,
  0
),
(
  'terms',
  'شروط الاستخدام',
  'Terms of use',
  'تقدم منصة KSA.MEN أدوات لإنشاء وإدارة هوية رقمية وموقع شخصي مهني على نطاق فرعي. المالك القانوني للمنصة هو شركة رجال الوطن القابضة، واسم الشركة في الشهادة هو شركة رجال الوطن بالرقم الموحد 7050011712 والصادرة بتاريخ 10/05/2025، وهي شركة ذات مسؤولية محدودة من شخص واحد. استخدام الخدمة يعني الالتزام بتقديم بيانات ومحتوى تملك حق استخدامه، وعدم انتحال شخص أو جهة، وعدم نشر محتوى مخالف أو روابط غير آمنة أو محاولة تجاوز المراجعة أو الحماية أو صلاحيات الحسابات. يبقى النشر خاضعاً لمراجعة مخولة، ولا يؤدي حفظ المسودة أو رفع الملفات أو إنشاء موقع بالنيابة إلى نشره تلقائياً.\n\nتمنح نقاط الوسط كرصيد غير نقدي داخل المنصة ولا يمكن سحبها نقداً. لا يصبح طلب الدفع اشتراكاً فعالاً قبل التحقق والاعتماد، ويمكن معالجة إبطال اعتماد سابق بسجل صريح وحركات تعويضية بدلاً من تغيير السجل التاريخي. تبقى ملكية الاسم منفصلة عن محتوى الموقع؛ نقل الاسم لا ينقل السيرة أو الوسائط أو بيانات المالك السابق، وقد تتوقف الروابط القديمة عن عرض هذا المحتوى.\n\nالمراسلة اختيارية وتحتاج موافقة صريحة من المستفيد لكل جلسة، وتنتهي الجلسة بعد 24 ساعة من آخر نشاط أو عند الإنهاء أو الحظر. النصوص والملفات الخاصة ليست مخصصة للاطلاع الإداري الاعتيادي. يجوز للمنصة تعليق وصول أو خدمة أو محتوى عند وجود سبب تشغيلي أو أمني موثق، مع الاحتفاظ بسجل الإجراء حيث يلزم. هذه الشروط تشغيلية وليست بديلاً عن مراجعة قانونية متخصصة قبل الإطلاق العام.',
  'KSA.MEN provides tools for creating and managing a professional digital identity and personal website on a subdomain. The platform’s legal owner is Rijal Al Watan Holding Company (شركة رجال الوطن القابضة). The certificate company name is Rijal Al Watan Company (شركة رجال الوطن), Unified No. 7050011712, issued on 10/05/2025; it is a single-person limited liability company. Use of the service requires users to provide information and content they are entitled to use, and not to impersonate a person or organization, publish unlawful content or unsafe links, or attempt to bypass review, protections or account permissions. Publication remains subject to authorized review. Saving a draft, uploading media or creating a site on another person’s behalf does not publish it automatically.\n\nMid Points are non-cash credits inside the platform and cannot be redeemed for cash. A payment request does not activate a subscription until it is verified and approved. Any later reversal is handled through an explicit record and compensating movements rather than by replacing historical records. Name ownership is separate from site content: transferring a name does not move the prior owner’s profile, media or data, and prior links may cease to display that content.\n\nMessaging is optional and requires explicit recipient approval for each session. A session ends 24 hours after its last activity, or immediately when it is ended or blocked. Private text and files are not for ordinary administrative viewing. The platform may suspend access, a service or content for a documented operational or security reason, with an action record where appropriate. These are operational terms and are not a substitute for specialist legal review before public launch.',
  'published',
  0,
  0
)
ON CONFLICT(slug) DO UPDATE SET
  title_ar=excluded.title_ar,
  title_en=excluded.title_en,
  body_ar=excluded.body_ar,
  body_en=excluded.body_en,
  status=excluded.status,
  updated_at=excluded.updated_at;
