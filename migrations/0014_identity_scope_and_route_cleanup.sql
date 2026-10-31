PRAGMA foreign_keys=ON;

-- Phase 5 follow-up: member names and site custody are non-transferable in the active product.
-- Historic audit rows remain intact; only unresolved requests are closed without changing an owner.
UPDATE transfers
SET status='cancelled', decided_at=COALESCE(decided_at, strftime('%s','now'))
WHERE status IN ('pending','accepted');

UPDATE handovers
SET status='cancelled'
WHERE status='pending';

-- External per-profile forwarding is removed from both editable and published JSON.
-- Malformed legacy payloads are deliberately left untouched for the existing integrity workflow.
UPDATE sites
SET
  draft=CASE WHEN json_valid(draft) THEN json_remove(draft,'$.redirect') ELSE draft END,
  published=CASE WHEN published IS NOT NULL AND json_valid(published) THEN json_remove(published,'$.redirect') ELSE published END,
  updated_at=strftime('%s','now')
WHERE (json_valid(draft) AND json_extract(draft,'$.redirect') IS NOT NULL)
   OR (published IS NOT NULL AND json_valid(published) AND json_extract(published,'$.redirect') IS NOT NULL);

-- Members with no uploaded portrait use the platform emblem until their own image or logo is saved.
UPDATE sites
SET
  draft=CASE WHEN json_valid(draft) AND json_extract(draft,'$.photo')='/assets/icon-192.png' THEN json_set(draft,'$.photo','/assets/logo-emblem.webp') ELSE draft END,
  published=CASE WHEN published IS NOT NULL AND json_valid(published) AND json_extract(published,'$.photo')='/assets/icon-192.png' THEN json_set(published,'$.photo','/assets/logo-emblem.webp') ELSE published END,
  updated_at=strftime('%s','now')
WHERE (json_valid(draft) AND json_extract(draft,'$.photo')='/assets/icon-192.png')
   OR (published IS NOT NULL AND json_valid(published) AND json_extract(published,'$.photo')='/assets/icon-192.png');

-- The historical preference columns remain only to preserve migration integrity; the active application never reads or exposes them.
UPDATE content
SET
  body_ar=CASE WHEN instr(body_ar,'الرجال السعوديون والمقيمون والمحبون للمملكة العربية السعودية')=0 THEN body_ar || '

تُقدَّم المنصة للرجال السعوديين والمقيمين والمحبين للمملكة العربية السعودية ممن بلغوا 18 عاماً.' ELSE body_ar END,
  body_en=CASE WHEN instr(body_en,'Saudi men, residents, and people who value the Kingdom')=0 THEN body_en || '

The platform is offered to Saudi men, residents, and people who value the Kingdom who are 18 or older.' ELSE body_en END,
  updated_at=strftime('%s','now')
WHERE slug='terms';
