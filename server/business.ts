import { HTTPException } from 'hono/http-exception';
import type { App } from './core';
import {
  all,
  audit,
  fresh,
  hashSecret,
  me,
  now,
  one,
  run,
  service,
  serviceState,
  uid,
  recordConsent,
  withdrawConsent,
} from './core';
import { hideMyPublicPresence, requestDeletionLifecycle } from './lifecycle';

type Json = Record<string, unknown>;
type SiteRow = {
  id: string;
  name?: string | null;
  user_id: number | null;
  manager_id: number | null;
  draft: string;
  draft_version: number;
  published: string | null;
  published_version: number;
  status: string;
  lock_hash: string | null;
  lock_message: string;
  searchable: number;
  allow_contact: number;
  branding: number;
  created_at: number;
  updated_at: number;
  authorization: string | null;
};

type Profile = {
  name: string;
  title: string;
  bio: string;
  email: string;
  phone: string;
  whatsapp: string;
  city: string;
  country: string;
  photo: string;
  cover: string;
  youtube: string;
  experience: Array<string | Json>;
  education: Array<string | Json>;
  training: Array<string | Json>;
  skills: Array<string | Json>;
  memberships: Array<string | Json>;
  languages: Array<string | Json>;
  hobbies: Array<string | Json>;
  achievements: Array<string | Json>;
  timeline: Array<string | Json>;
  skillRadar: { human: string[]; scientific: string[]; professional: string[] };
  blog: string;
  notes: string;
  skillImages: string[];
  workImages: string[];
  socials: Array<string | { label: string; url: string }>;
  buttons: Array<string | { label: string; url: string }>;
  hidden: string[];
  searchable: boolean;
  allowContact: boolean;
  redirect?: string;
  translations?: { ar?: Profile; en?: Profile };
};

type NamedUser = { id: number; email: string; name: string; status: string };
type D1ResultLike = { meta?: { changes?: number } };

// DNS labels are stored canonically: lowercase, 1–63 characters, with no edge hyphen.
// Consecutive internal hyphens are valid DNS syntax; the legacy database guard is recorded below.
const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MEDIA_URL_RE = /^\/api\/media\/[A-Za-z0-9_-]{1,160}$/;
const ASSET_URLS = new Set(['/assets/logo.webp', '/assets/icon-192.png', '/assets/cover-1600.webp']);
const PROFILE_KEYS = new Set([
  'name', 'title', 'bio', 'email', 'phone', 'whatsapp', 'city', 'country',
  'photo', 'cover', 'youtube', 'experience', 'education', 'training', 'skills',
  'memberships', 'languages', 'hobbies', 'achievements', 'timeline', 'skillRadar', 'blog', 'notes', 'skillImages',
  'workImages', 'socials', 'buttons', 'hidden', 'searchable', 'allowContact',
  'redirect', 'translations',
]);
const PUBLIC_PROFILE_KEYS = new Set([
  'name', 'title', 'bio', 'email', 'phone', 'whatsapp', 'city', 'country', 'photo',
  'cover', 'youtube', 'experience', 'education', 'training', 'skills', 'memberships',
  'languages', 'hobbies', 'achievements', 'timeline', 'skillRadar', 'blog', 'skillImages', 'workImages',
  'socials', 'buttons', 'redirect',
]);
const RESUME_LISTS = [
  'experience', 'education', 'training', 'skills', 'memberships', 'languages',
  'hobbies', 'achievements', 'timeline',
] as const;
const QUICK_FIELDS = new Set(['name', 'title', 'whatsapp', 'email', 'site']);
const QUICK_LINK_MODES = new Set(['professional', 'business', 'quick']);

function apiError(status: number, error: string, code?: string): never {
  throw new HTTPException(status as 400, {
    res: new Response(JSON.stringify({ error, ...(code ? { code } : {}) }), {
      status,
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    }),
  });
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function requestBody(c: { req: { json: () => Promise<unknown> } }): Promise<Json> {
  try {
    const value = await c.req.json();
    if (!isRecord(value)) apiError(400, 'A JSON object is required', 'INVALID_BODY');
    return value;
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    apiError(400, 'Invalid JSON request body', 'INVALID_JSON');
  }
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed as T;
  } catch {
    return fallback;
  }
}

function changes(result: unknown): number {
  return Number((result as D1ResultLike | undefined)?.meta?.changes ?? 0);
}

function asInteger(value: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    apiError(422, `${field} must be an integer between ${min} and ${max}`, 'VALIDATION');
  }
  return value;
}

function asString(value: unknown, field: string, max: number, required = false): string {
  if (value === undefined || value === null) {
    if (required) apiError(422, `${field} is required`, 'VALIDATION');
    return '';
  }
  if (typeof value !== 'string') apiError(422, `${field} must be a string`, 'VALIDATION');
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > max) {
    apiError(422, `${field} has an invalid length`, 'VALIDATION');
  }
  return normalized;
}

function asBoolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') apiError(422, `${field} must be boolean`, 'VALIDATION');
  return value;
}

function emailValue(value: unknown, field: string): string {
  const email = asString(value, field, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    apiError(422, `${field} must be a valid email address`, 'VALIDATION');
  }
  return email;
}

function phoneValue(value: unknown, field: string): string {
  const phone = asString(value, field, 32);
  if (phone && (!/^[0-9+()\-\s.]+$/.test(phone) || phone.replace(/\D/g, '').length < 6)) {
    apiError(422, `${field} must be a valid phone number`, 'VALIDATION');
  }
  return phone;
}

function httpUrl(value: unknown, field: string): string {
  const raw = asString(value, field, 2048);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      apiError(422, `${field} must be a safe HTTP(S) URL`, 'VALIDATION');
    }
    return url.toString();
  } catch {
    apiError(422, `${field} must be a valid URL`, 'VALIDATION');
  }
}

function mediaUrl(value: unknown, field: string): string {
  const url = asString(value, field, 220);
  if (!url) return '';
  if (!MEDIA_URL_RE.test(url) && !ASSET_URLS.has(url)) {
    apiError(422, `${field} must reference an approved media URL`, 'VALIDATION');
  }
  return url;
}

function youtubeUrl(value: unknown): string {
  const url = httpUrl(value, 'youtube');
  if (!url) return '';
  const host = new URL(url).hostname.toLowerCase();
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) {
    apiError(422, 'youtube must be a YouTube URL', 'VALIDATION');
  }
  return url;
}

function defaultProfile(name = ''): Profile {
  return {
    name,
    title: '',
    bio: '',
    email: '',
    phone: '',
    whatsapp: '',
    city: '',
    country: 'Saudi Arabia',
    photo: '/assets/icon-192.png',
    cover: '/assets/cover-1600.webp',
    youtube: '',
    experience: [],
    education: [],
    training: [],
    skills: [],
    memberships: [],
    languages: [],
    hobbies: [],
    achievements: [],
    timeline: [],
    skillRadar: { human: [], scientific: [], professional: [] },
    blog: '',
    notes: '',
    skillImages: [],
    workImages: [],
    socials: [],
    buttons: [],
    hidden: [],
    searchable: true,
    allowContact: true,
  };
}

function structuredItem(value: unknown, field: string): string | Json {
  if (typeof value === 'string') return asString(value, field, 500, true);
  if (!isRecord(value)) apiError(422, `${field} items must be strings or structured entries`, 'VALIDATION');
  const allowed = new Set(['title', 'organization', 'start', 'end', 'description']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) apiError(422, `${field} contains an unsupported entry field`, 'VALIDATION');
  }
  const item = {
    title: asString(value.title, `${field}.title`, 240, true),
    organization: asString(value.organization, `${field}.organization`, 240),
    start: asString(value.start, `${field}.start`, 40),
    end: asString(value.end, `${field}.end`, 40),
    description: asString(value.description, `${field}.description`, 3000),
  };
  return item;
}

function profileList(value: unknown, field: string, maximum = 30): Array<string | Json> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) {
    apiError(422, `${field} must contain at most ${maximum} items`, 'VALIDATION');
  }
  return value.map((item) => structuredItem(item, field));
}

function stringList(value: unknown, field: string, maximum = 30): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) apiError(422, `${field} must contain at most ${maximum} items`, 'VALIDATION');
  return value.map((item) => asString(item, field, 180, true));
}

function skillRadar(value: unknown): Profile['skillRadar'] {
  if (value === undefined) return { human: [], scientific: [], professional: [] };
  if (!isRecord(value)) apiError(422, 'skillRadar must be an object', 'VALIDATION');
  for (const key of Object.keys(value)) if (!['human', 'scientific', 'professional'].includes(key)) apiError(422, `skillRadar cannot include ${key}`, 'VALIDATION');
  return {
    human: stringList(value.human, 'skillRadar.human'),
    scientific: stringList(value.scientific, 'skillRadar.scientific'),
    professional: stringList(value.professional, 'skillRadar.professional'),
  };
}

function mediaList(value: unknown, field: string, maximum: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) {
    apiError(422, `${field} must contain at most ${maximum} images`, 'VALIDATION');
  }
  return value.map((item) => mediaUrl(item, field));
}

function linkList(value: unknown, field: string, maximum: number): Array<string | { label: string; url: string }> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) {
    apiError(422, `${field} must contain at most ${maximum} links`, 'VALIDATION');
  }
  return value.map((item) => {
    if (typeof item === 'string') return httpUrl(item, field);
    if (!isRecord(item)) apiError(422, `${field} entries must be URLs or {label,url}`, 'VALIDATION');
    const allowed = new Set(['label', 'url']);
    for (const key of Object.keys(item)) {
      if (!allowed.has(key)) apiError(422, `${field} contains an unsupported link field`, 'VALIDATION');
    }
    return {
      label: asString(item.label, `${field}.label`, 100, true),
      url: httpUrl(item.url, `${field}.url`),
    };
  });
}

/** Normalizes the complete profile schema and rejects unrecognised content rather than storing it blindly. */
function normalizeProfile(value: unknown, fallbackName = '', nested = false): Profile {
  if (!isRecord(value)) apiError(422, 'draft must be a profile object', 'VALIDATION');
  for (const key of Object.keys(value)) {
    if (!PROFILE_KEYS.has(key) || (nested && key === 'translations')) {
      apiError(422, `Unsupported profile field: ${key}`, 'VALIDATION');
    }
  }
  const profile = defaultProfile(fallbackName);
  profile.name = asString(value.name ?? fallbackName, 'name', 160, true);
  profile.title = asString(value.title, 'title', 180);
  profile.bio = asString(value.bio, 'bio', 5000);
  profile.email = emailValue(value.email, 'email');
  profile.phone = phoneValue(value.phone, 'phone');
  profile.whatsapp = phoneValue(value.whatsapp, 'whatsapp');
  profile.city = asString(value.city, 'city', 120);
  profile.country = asString(value.country ?? profile.country, 'country', 120);
  profile.photo = mediaUrl(value.photo ?? profile.photo, 'photo');
  profile.cover = mediaUrl(value.cover ?? profile.cover, 'cover');
  profile.youtube = youtubeUrl(value.youtube);
  for (const field of RESUME_LISTS) profile[field] = profileList(value[field], field);
  profile.skillRadar = skillRadar(value.skillRadar);
  profile.blog = asString(value.blog, 'blog', 12_000);
  profile.notes = asString(value.notes, 'notes', 12_000);
  profile.skillImages = mediaList(value.skillImages, 'skillImages', 3);
  profile.workImages = mediaList(value.workImages, 'workImages', 4);
  profile.socials = linkList(value.socials, 'socials', 12);
  profile.buttons = linkList(value.buttons, 'buttons', 3);

  if (value.hidden !== undefined) {
    if (!Array.isArray(value.hidden) || value.hidden.length > PUBLIC_PROFILE_KEYS.size) {
      apiError(422, 'hidden must be a bounded list of profile field keys', 'VALIDATION');
    }
    const hidden = value.hidden.map((field) => {
      const key = asString(field, 'hidden field', 40, true);
      if (!PUBLIC_PROFILE_KEYS.has(key)) apiError(422, `hidden cannot include ${key}`, 'VALIDATION');
      return key;
    });
    if (new Set(hidden).size !== hidden.length) apiError(422, 'hidden cannot contain duplicates', 'VALIDATION');
    profile.hidden = hidden;
  }
  profile.searchable = asBoolean(value.searchable, 'searchable', profile.searchable);
  profile.allowContact = asBoolean(value.allowContact, 'allowContact', profile.allowContact);
  if (value.redirect !== undefined) {
    const redirect = httpUrl(value.redirect, 'redirect');
    if (redirect) profile.redirect = redirect;
  }
  if (!nested && value.translations !== undefined) {
    if (!isRecord(value.translations)) apiError(422, 'translations must be an object', 'VALIDATION');
    for (const key of Object.keys(value.translations)) {
      if (key !== 'ar' && key !== 'en') apiError(422, 'translations only supports ar and en', 'VALIDATION');
    }
    const translations: { ar?: Profile; en?: Profile } = {};
    if (value.translations.ar !== undefined) translations.ar = normalizeProfile(value.translations.ar, profile.name, true);
    if (value.translations.en !== undefined) translations.en = normalizeProfile(value.translations.en, profile.name, true);
    profile.translations = translations;
  }
  return profile;
}

function mediaIds(profile: Profile): string[] {
  const ids = new Set<string>();
  const add = (url: string) => {
    const match = /^\/api\/media\/([A-Za-z0-9_-]{1,160})$/.exec(url);
    if (match) ids.add(match[1]);
  };
  add(profile.photo);
  add(profile.cover);
  profile.skillImages.forEach(add);
  profile.workImages.forEach(add);
  if (profile.translations?.ar) mediaIds(profile.translations.ar).forEach((id) => ids.add(id));
  if (profile.translations?.en) mediaIds(profile.translations.en).forEach((id) => ids.add(id));
  return [...ids];
}

async function assertProfileMediaEditable(
  c: any,
  profile: Profile,
  editorId: number,
  site: Pick<SiteRow, 'id' | 'user_id'>,
): Promise<void> {
  const ids = mediaIds(profile);
  if (!ids.length) return;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await all<{ id: string }>(
    c,
    `SELECT id FROM media
     WHERE id IN (${placeholders})
       AND purpose IN ('photo','cover','skill','work')
       AND (owner_id=? OR site_id=? OR (? IS NOT NULL AND owner_id=?))`,
    ...ids,
    editorId,
    site.id,
    site.user_id,
    site.user_id,
  );
  if (rows.length !== ids.length) {
    apiError(403, 'A profile may only reference permitted profile media for this site', 'MEDIA_FORBIDDEN');
  }
}

function normalizedName(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function safeName(value: unknown): string {
  const name = normalizedName(value);
  if (!name || !NAME_RE.test(name)) {
    apiError(422, 'Name must be lowercase DNS text from 1 to 63 characters', 'INVALID_NAME');
  }
  return name;
}

function isUuid(value: string): boolean {
  if (value.length !== 36) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (index === 8 || index === 13 || index === 18 || index === 23) {
      if (value[index] !== '-') return false;
      continue;
    }
    const code = value.charCodeAt(index);
    const hexadecimal = (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
    if (!hexadecimal) return false;
  }
  const version = value[14].toLowerCase();
  const variant = value[19].toLowerCase();
  return '12345678'.includes(version) && '89ab'.includes(variant);
}

function safeIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !isUuid(value)) {
    apiError(422, 'idempotencyKey must be a UUID', 'INVALID_IDEMPOTENCY_KEY');
  }
  return value.toLowerCase();
}

function toSite(site: SiteRow): Json {
  return {
    id: site.id,
    name: site.name ?? null,
    userId: site.user_id === null ? null : `C${site.user_id}`,
    managerId: site.manager_id === null ? null : `C${site.manager_id}`,
    draft: parseJson<Profile>(site.draft, defaultProfile()),
    draft_version: Number(site.draft_version),
    draftVersion: Number(site.draft_version),
    published: site.published ? parseJson<Profile | null>(site.published, null) : null,
    published_version: Number(site.published_version),
    publishedVersion: Number(site.published_version),
    status: site.status,
    lock: { enabled: Boolean(site.lock_hash), message: site.lock_message || '' },
    searchable: Boolean(site.searchable),
    allowContact: Boolean(site.allow_contact),
    branding: Boolean(site.branding),
    createdAt: Number(site.created_at),
    updatedAt: Number(site.updated_at),
    authorization: site.authorization,
  };
}

function toReview(review: Record<string, unknown>): Json {
  return {
    id: review.id,
    site_id: review.site_id,
    siteId: review.site_id,
    user_id: `C${review.user_id}`,
    userId: `C${review.user_id}`,
    snapshot: parseJson<unknown>(review.snapshot, {}),
    draft_version: Number(review.draft_version),
    draftVersion: Number(review.draft_version),
    base_version: Number(review.base_version),
    baseVersion: Number(review.base_version),
    status: review.decision_status ?? review.status,
    kind: review.kind,
    reviewer_id: review.reviewer_id === null || review.reviewer_id === undefined ? null : `C${review.reviewer_id}`,
    reviewerId: review.reviewer_id === null || review.reviewer_id === undefined ? null : `C${review.reviewer_id}`,
    reason: review.decision_reason ?? review.reason ?? null,
    created_at: Number(review.created_at),
    createdAt: Number(review.created_at),
    decided_at: review.decision_decided_at ?? review.decided_at ?? null,
    decidedAt: review.decision_decided_at ?? review.decided_at ?? null,
  };
}

function toDashboardUser(user: Record<string, unknown>, balance: number): Json {
  return {
    id: `C${user.id}`,
    email: user.email,
    name: user.name,
    whatsapp: user.whatsapp,
    role: user.role,
    status: user.status,
    trial_until: Number(user.trial_until),
    entitlement_until: Number(user.entitlement_until),
    balance,
  };
}

function bankInstructions(value: string | null | undefined): Json | null {
  const parsed = parseJson<Json>(value, {});
  const active = parsed.enabled === true || parsed.active === true;
  const beneficiary = typeof parsed.beneficiary === 'string'
    ? parsed.beneficiary.trim()
    : typeof parsed.accountName === 'string'
      ? parsed.accountName.trim()
      : typeof parsed.accountHolder === 'string'
        ? parsed.accountHolder.trim()
        : '';
  const iban = typeof parsed.iban === 'string' ? parsed.iban.trim() : '';
  const account = typeof parsed.account === 'string'
    ? parsed.account.trim()
    : typeof parsed.accountNumber === 'string'
      ? parsed.accountNumber.trim()
      : '';
  // A bank name is deliberately not inferred or manufactured: only supplied official details are exposed.
  if (!active || !beneficiary || !iban || !account) return null;
  return { beneficiary, iban, account };
}

async function resolveRecipient(c: any, value: unknown): Promise<NamedUser> {
  if (typeof value !== 'string') apiError(422, 'recipient must be a C identifier, account name, profile name, or email', 'VALIDATION');
  const recipient = value.trim();
  if (!recipient || recipient.length > 254) apiError(422, 'recipient has an invalid length', 'VALIDATION');
  // C identifiers are case-insensitive at the API boundary; the canonical response remains C#.
  const cMatch = /^c([1-9]\d*)$/i.exec(recipient);
  let results: NamedUser[];
  if (cMatch) {
    results = await all<NamedUser>(c, 'SELECT id,email,name,status FROM users WHERE id=? AND status=\'active\'', Number(cMatch[1]));
  } else {
    const lookup = recipient.toLowerCase();
    results = await all<NamedUser>(
      c,
      `SELECT DISTINCT u.id,u.email,u.name,u.status
       FROM users u
       LEFT JOIN dns_names n ON n.owner_id=u.id
       WHERE u.status='active' AND (lower(u.email)=? OR lower(u.name)=? OR n.name=?)
       ORDER BY u.id ASC LIMIT 2`,
      lookup,
      lookup,
      lookup,
    );
  }
  if (!results.length) apiError(404, 'Active recipient account not found', 'RECIPIENT_NOT_FOUND');
  if (results.length > 1) apiError(409, 'Recipient name is ambiguous; use a C identifier or email', 'RECIPIENT_AMBIGUOUS');
  return results[0];
}

async function primarySite(c: any, userId: number): Promise<(SiteRow & { name?: string | null }) | null> {
  return one<SiteRow & { name?: string | null }>(
    c,
    `SELECT s.*, (
       SELECT n.name FROM dns_names n WHERE n.site_id=s.id AND n.owner_id=? ORDER BY n.created_at ASC LIMIT 1
     ) AS name
     FROM sites s WHERE s.user_id=? ORDER BY s.created_at ASC LIMIT 1`,
    userId,
    userId,
  );
}

async function withSiteName(c: any, site: SiteRow): Promise<SiteRow> {
  const named = await one<{ name: string }>(c, 'SELECT name FROM dns_names WHERE site_id=? ORDER BY created_at ASC LIMIT 1', site.id);
  return { ...site, name: named?.name ?? null };
}

/** Allows only an owner, site owner, explicit site manager/proxy creator, or assigned manager to edit. */
async function editableSiteFor(c: any, id: string, editor: Record<string, unknown>): Promise<SiteRow> {
  const site = await one<SiteRow>(c, 'SELECT * FROM sites WHERE id=?', id);
  if (!site) apiError(404, 'Site not found', 'SITE_NOT_FOUND');
  const editorId = Number(editor.id);
  if (String(editor.role) === 'owner' || site.user_id === editorId || site.manager_id === editorId) return site;
  if (String(editor.role) === 'manager' && site.user_id !== null) {
    const assigned = await one<{ id: number }>(
      c,
      'SELECT id FROM users WHERE id=? AND assigned_to=? AND status=\'active\'',
      site.user_id,
      editorId,
    );
    if (assigned) return site;
  }
  apiError(403, 'This site is outside your editing scope', 'SITE_FORBIDDEN');
}

async function toDashboardService(c: any, item: Record<string, unknown>, userId: number): Promise<Json> {
  const state = await serviceState(c, String(item.key), userId) as {
    enabled: boolean;
    entitled: boolean;
    policy?: unknown;
    override?: unknown;
    sources?: unknown;
    reason?: unknown;
  };
  const override = isRecord(state.override) ? state.override : null;
  return {
    key: item.key,
    name_ar: item.name_ar,
    name_en: item.name_en,
    nameAr: item.name_ar,
    nameEn: item.name_en,
    enabled: state.enabled,
    premium: Boolean(item.premium),
    entitled: state.entitled,
    until_at: typeof override?.untilAt === 'number' && override.untilAt > 0 ? override.untilAt : null,
    policy: isRecord(state.policy) ? state.policy : parseJson<Json>(item.policy, {}),
    override,
    sources: Array.isArray(state.sources) ? state.sources : [],
    reason: typeof state.reason === 'string' ? state.reason : null,
  };
}

function toQuickLink(row: Record<string, unknown>, rootDomain: string): Json {
  const payload = parseJson<{ fields?: unknown; mode?: unknown }>(row.payload, {});
  const fields = Array.isArray(payload.fields) ? payload.fields.filter((field): field is string => typeof field === 'string') : [];
  const mode = typeof payload.mode === 'string' && QUICK_LINK_MODES.has(payload.mode) ? payload.mode : 'professional';
  return {
    id: row.id,
    url: `https://${rootDomain}/quick/${row.id}`,
    mode,
    fields,
    expires_at: Number(row.expires_at),
    expiresAt: Number(row.expires_at),
    created_at: Number(row.created_at),
    createdAt: Number(row.created_at),
    revoked: Boolean(row.revoked),
  };
}

function quality(profile: Profile): { score: number; recommendations: string[]; completed: string[] } {
  let score = 0;
  const recommendations: string[] = [];
  const completed: string[] = [];
  const add = (ok: boolean, points: number, done: string, recommendation: string) => {
    if (ok) {
      score += points;
      completed.push(done);
    } else {
      recommendations.push(recommendation);
    }
  };
  add(Boolean(profile.name && profile.title), 15, 'professional identity', 'Add a clear professional title.');
  add(profile.bio.length >= 60, 10, 'professional bio', 'Write a concise professional bio of at least a few sentences.');
  add(Boolean(profile.email || profile.phone || profile.whatsapp), 15, 'contact method', 'Add at least one contact method.');
  add(Boolean(profile.city && profile.country), 10, 'location', 'Add city and country.');
  add(profile.experience.length > 0, 15, 'experience', 'Add at least one professional experience.');
  add(profile.education.length > 0 || profile.training.length > 0, 10, 'education or training', 'Add education or training details.');
  add(profile.skills.length >= 3, 10, 'skills', 'List at least three skills.');
  add(profile.skillImages.length > 0 || profile.workImages.length > 0, 5, 'work evidence', 'Add skill or work samples.');
  add(profile.socials.length > 0 || profile.buttons.length > 0, 5, 'share links', 'Add a professional social or custom link.');
  add(Boolean(profile.photo || profile.cover), 5, 'visual identity', 'Add a profile photo or cover.');
  return { score, recommendations, completed };
}

/** Registers all authenticated user-business routes. */
export function registerBusiness(app: App): void {
  app.get('/api/dashboard', async (c) => {
    const user = me(c) as unknown as Record<string, unknown>;
    const userId = Number(user.id);
    const checkedAt = now();
    const [sites, reviews, wallet, ledger, payments, services, notifications, quickLinks, transfers, handovers, analyticsRows, unboundNames] = await Promise.all([
      all<SiteRow>(
        c,
        `SELECT s.*,(
           SELECT n.name FROM dns_names n WHERE n.site_id=s.id ORDER BY n.created_at ASC LIMIT 1
         ) AS name
         FROM sites s
         LEFT JOIN users site_owner ON site_owner.id=s.user_id
         WHERE s.user_id=? OR s.manager_id=? OR (?='manager' AND site_owner.assigned_to=?)
         ORDER BY s.updated_at DESC`,
        userId,
        userId,
        String(user.role ?? ''),
        userId,
      ),
      all<Record<string, unknown>>(c, 'SELECT r.*,d.status AS decision_status,d.reviewer_id AS decision_reviewer_id,d.reason AS decision_reason,d.decided_at AS decision_decided_at FROM reviews r LEFT JOIN review_decisions d ON d.review_id=r.id WHERE r.user_id=? ORDER BY r.created_at DESC LIMIT 100', userId),
      one<{ balance: number }>(c, 'SELECT balance FROM wallets WHERE user_id=?', userId),
      all<Record<string, unknown>>(
        c,
        `SELECT l.*, CASE WHEN l.from_id=? THEN l.to_id ELSE l.from_id END AS counterparty_id,
          u.name AS counterparty_name
         FROM ledger l
         LEFT JOIN users u ON u.id=CASE WHEN l.from_id=? THEN l.to_id ELSE l.from_id END
         WHERE l.from_id=? OR l.to_id=? ORDER BY l.created_at DESC LIMIT 150`,
        userId,
        userId,
        userId,
        userId,
      ),
      all<Record<string, unknown>>(c, 'SELECT * FROM payments WHERE user_id=? ORDER BY created_at DESC LIMIT 100', userId),
      all<Record<string, unknown>>(
        c,
        `SELECT s.*, us.mode AS override_mode, us.until_at AS override_until
         FROM services s LEFT JOIN user_services us ON us.key=s.key AND us.user_id=? ORDER BY s.key`,
        userId,
      ),
      all<Record<string, unknown>>(c, 'SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100', userId),
      all<Record<string, unknown>>(
        c,
        'SELECT * FROM quick_links WHERE user_id=? AND expires_at>? ORDER BY created_at DESC LIMIT 100',
        userId,
        checkedAt,
      ),
      all<Record<string, unknown>>(
        c,
        "SELECT * FROM transfers WHERE to_id=? AND status='pending' ORDER BY created_at DESC LIMIT 100",
        userId,
      ),
      all<Record<string, unknown>>(
        c,
        "SELECT * FROM handovers WHERE lower(target_email)=lower(?) AND status='pending' ORDER BY created_at DESC LIMIT 100",
        String(user.email),
      ),
      all<Record<string, unknown>>(
        c,
        `SELECT a.site_id,a.event,COUNT(*) AS total,
          SUM(CASE WHEN a.created_at>=? THEN 1 ELSE 0 END) AS last7
         FROM analytics a
         JOIN sites s ON s.id=a.site_id
         LEFT JOIN users site_owner ON site_owner.id=s.user_id
         WHERE (s.user_id=? OR s.manager_id=? OR (?='manager' AND site_owner.assigned_to=?))
           AND a.created_at>=?
         GROUP BY a.site_id,a.event`,
        checkedAt - 7 * 86_400,
        userId,
        userId,
        String(user.role ?? ''),
        userId,
        checkedAt - 30 * 86_400,
      ),
      all<{ name: string }>(
        c,
        'SELECT name FROM dns_names WHERE owner_id=? AND site_id IS NULL ORDER BY created_at ASC LIMIT 100',
        userId,
      ),
    ]);

    const analytics: Record<string, Record<string, number>> = {};
    for (const site of sites) {
      analytics[site.id] = { visits: 0, contactClicks: 0, vcardDownloads: 0, qrInteractions: 0, total: 0, last7Days: 0 };
    }
    for (const row of analyticsRows) {
      const siteId = String(row.site_id);
      const metrics = analytics[siteId] ?? { visits: 0, contactClicks: 0, vcardDownloads: 0, qrInteractions: 0, total: 0, last7Days: 0 };
      const count = Number(row.total ?? 0);
      metrics.total += count;
      metrics.last7Days += Number(row.last7 ?? 0);
      const event = String(row.event);
      if (event === 'visit' || event === 'page_view') metrics.visits += count;
      if (event === 'contact' || event === 'contact_click') metrics.contactClicks += count;
      if (event === 'vcard' || event === 'vcard_download') metrics.vcardDownloads += count;
      if (event === 'qr' || event === 'qr_scan' || event === 'qr_interaction') metrics.qrInteractions += count;
      analytics[siteId] = metrics;
    }
    const serviceStates = await Promise.all(services.map((item) => toDashboardService(c, item, userId)));

    return c.json({
      sites: sites.map(toSite),
      reviews: reviews.map(toReview),
      wallet: { balance: Number(wallet?.balance ?? 0) },
      ledger: ledger.map((row) => ({
        id: row.id,
        from_id: `C${row.from_id}`,
        fromId: `C${row.from_id}`,
        to_id: `C${row.to_id}`,
        toId: `C${row.to_id}`,
        amount: Number(row.amount),
        kind: row.kind,
        notes: row.notes,
        created_at: Number(row.created_at),
        createdAt: Number(row.created_at),
        reference: row.reference,
        counterparty_id: row.counterparty_id === null || row.counterparty_id === undefined ? null : `C${row.counterparty_id}`,
        counterpartyId: row.counterparty_id === null || row.counterparty_id === undefined ? null : `C${row.counterparty_id}`,
        counterparty_name: row.counterparty_name ?? null,
        counterpartyName: row.counterparty_name ?? null,
      })),
      payments: payments.map((payment) => ({
        id: payment.id,
        amount: Number(payment.amount),
        days: Number(payment.days),
        receipt_id: payment.receipt_id ?? null,
        receiptId: payment.receipt_id ?? null,
        status: payment.status,
        notes: payment.notes,
        created_at: Number(payment.created_at),
        createdAt: Number(payment.created_at),
        approved_at: payment.approved_at ?? null,
        approvedAt: payment.approved_at ?? null,
        reversed_at: payment.reversed_at ?? null,
        reversedAt: payment.reversed_at ?? null,
      })),
      // This mirrors core.serviceState, while core.service remains the enforcement boundary.
      services: serviceStates,
      notifications: notifications.map((notification) => ({
        id: notification.id,
        title: notification.title,
        body: notification.body,
        read_at: notification.read_at ?? null,
        readAt: notification.read_at ?? null,
        created_at: Number(notification.created_at),
        createdAt: Number(notification.created_at),
      })),
      analytics,
      quickLinks: quickLinks.map((link) => toQuickLink(link, c.env.ROOT_DOMAIN)),
      transfers: transfers.map((transfer) => ({
        id: transfer.id,
        name: transfer.name,
        from_id: `C${transfer.from_id}`,
        to_id: `C${transfer.to_id}`,
        status: transfer.status,
        created_at: Number(transfer.created_at),
        accepted_at: transfer.accepted_at ?? null,
      })),
      handovers: handovers.map((handover) => ({
        id: handover.id,
        site_id: handover.site_id,
        status: handover.status,
        creator_id: `C${handover.creator_id}`,
        created_at: Number(handover.created_at),
      })),
      // Ownership of a transferred label is intentionally independent from any prior site/content.
      unboundNames: unboundNames.map((item) => ({
        name: item.name,
      })),
      user: toDashboardUser(user, Number(wallet?.balance ?? 0)),
    });
  });

  app.get('/api/names/check', async (c) => {
    me(c);
    const candidate = normalizedName(c.req.query('name'));
    if (!NAME_RE.test(candidate)) {
      return c.json({
        name: candidate,
        valid: false,
        available: false,
        reason: 'Use lowercase letters, numbers, and single internal hyphens (1–63 characters).',
        suggestions: [],
      });
    }
    const [reserved, existing] = await Promise.all([
      one<{ name: string }>(c, 'SELECT name FROM reserved_names WHERE name=? AND active=1', candidate),
      one<{ name: string }>(c, 'SELECT name FROM dns_names WHERE name=?', candidate),
    ]);
    const available = !reserved && !existing;
    const suffixes = ['-sa', '1', '-pro'];
    const suggestions = available
      ? []
      : suffixes.map((suffix) => `${candidate.slice(0, Math.max(1, 63 - suffix.length))}${suffix}`).filter((item) => NAME_RE.test(item));
    return c.json({
      name: candidate,
      valid: true,
      available,
      reason: reserved ? 'This name is reserved for platform or policy use.' : existing ? 'This name is already registered.' : null,
      suggestions,
    });
  });

  app.post('/api/names/reserve', async (c) => {
    const user = me(c) as unknown as Record<string, unknown>;
    const userId = Number(user.id);
    const body = await requestBody(c);
    const name = safeName(body.name);
    const [reserved, existing] = await Promise.all([
      one<{ name: string }>(c, 'SELECT name FROM reserved_names WHERE name=? AND active=1', name),
      one<{ name: string }>(c, 'SELECT name FROM dns_names WHERE name=?', name),
    ]);
    if (reserved) apiError(409, 'This name is reserved', 'NAME_RESERVED');
    if (existing) apiError(409, 'This name is already registered', 'NAME_TAKEN');

    const createdAt = now();
    const proposedSiteId = uid();
    const initialDraft = JSON.stringify(defaultProfile(String(user.name ?? '')));
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO sites(id,user_id,manager_id,draft,draft_version,published,published_version,status,lock_message,searchable,allow_contact,branding,created_at,updated_at)
           SELECT ?,?,NULL,?,0,NULL,0,'draft','',1,1,1,?,?
           WHERE NOT EXISTS (SELECT 1 FROM sites WHERE user_id=?)`,
        ).bind(proposedSiteId, userId, initialDraft, createdAt, createdAt, userId),
        c.env.DB.prepare(
          `INSERT INTO dns_names(name,owner_id,site_id,created_at)
           SELECT ?,?,id,? FROM sites WHERE user_id=?`,
        ).bind(name, userId, createdAt, userId),
      ]);
    } catch {
      // The database name trigger/unique key is the authority under concurrent reservations.
      const winner = await one<{ name: string }>(c, 'SELECT name FROM dns_names WHERE name=?', name);
      if (winner) apiError(409, 'This name was just registered by another account', 'NAME_CONFLICT');
      const blocked = await one<{ name: string }>(c, 'SELECT name FROM reserved_names WHERE name=? AND active=1', name);
      if (blocked) apiError(409, 'This name is reserved', 'NAME_RESERVED');
      apiError(409, 'The name reservation could not be completed', 'NAME_CONFLICT');
    }
    const reservedName = await one<{ name: string; site_id: string; created_at: number }>(
      c,
      'SELECT name,site_id,created_at FROM dns_names WHERE name=? AND owner_id=?',
      name,
      userId,
    );
    if (!reservedName) apiError(409, 'The name reservation conflicted with another request', 'NAME_CONFLICT');
    const site = await one<SiteRow>(c, 'SELECT * FROM sites WHERE id=? AND user_id=?', reservedName.site_id, userId);
    if (!site) apiError(500, 'Profile site could not be created', 'SITE_CREATE_FAILED');
    await audit(c, 'name.reserve', name, { siteId: site.id });
    return c.json({ name: reservedName.name, site: toSite({ ...site, name: reservedName.name }), createdAt: Number(reservedName.created_at) }, 201);
  });

  app.post('/api/names/:name/attach', async (c) => {
    const user = me(c) as unknown as Record<string, unknown>;
    await fresh(c);
    const userId = Number(user.id);
    const name = safeName(c.req.param('name'));
    const body = await requestBody(c);
    // Omitting siteId asks the server to create the user's first personal site. Supplying an
    // empty or malformed identifier is never treated as that create request.
    const requestedSiteId = body.siteId === undefined || body.siteId === null
      ? ''
      : asString(body.siteId, 'siteId', 160, true);
    const owned = await one<{ name: string; site_id: string | null }>(
      c,
      'SELECT name,site_id FROM dns_names WHERE name=? AND owner_id=?',
      name,
      userId,
    );
    if (!owned) apiError(404, 'You do not own this name', 'NAME_NOT_OWNED');
    if (owned.site_id !== null) apiError(409, 'This name is already attached to a site', 'NAME_ALREADY_ATTACHED');

    const attachedAt = now();
    let siteId = requestedSiteId;
    let createdSite = false;
    if (siteId) {
      const result = await run(
        c,
        `UPDATE dns_names SET site_id=?
         WHERE name=? AND owner_id=? AND site_id IS NULL
           AND EXISTS(SELECT 1 FROM sites WHERE id=? AND user_id=?)`,
        siteId,
        name,
        userId,
        siteId,
        userId,
      );
      if (changes(result) !== 1) {
        const target = await one<{ id: string; user_id: number | null }>(c, 'SELECT id,user_id FROM sites WHERE id=?', siteId);
        if (!target) apiError(404, 'Site not found', 'SITE_NOT_FOUND');
        if (Number(target.user_id) !== userId) apiError(403, 'You can only attach a name to your own site', 'SITE_FORBIDDEN');
        const current = await one<{ owner_id: number; site_id: string | null }>(c, 'SELECT owner_id,site_id FROM dns_names WHERE name=?', name);
        if (!current || Number(current.owner_id) !== userId) apiError(404, 'You do not own this name', 'NAME_NOT_OWNED');
        if (current.site_id !== null) apiError(409, 'This name was attached by another request', 'NAME_ALREADY_ATTACHED');
        apiError(409, 'The name could not be attached', 'NAME_ATTACH_CONFLICT');
      }
    } else {
      const existing = await primarySite(c, userId);
      if (existing) {
        apiError(422, 'siteId is required when you already have a profile site', 'SITE_ID_REQUIRED');
      }
      siteId = uid();
      const initialDraft = JSON.stringify(defaultProfile(String(user.name ?? '')));
      let results: D1ResultLike[];
      try {
        results = await c.env.DB.batch([
          c.env.DB.prepare(
            `INSERT INTO sites(id,user_id,manager_id,draft,draft_version,published,published_version,status,lock_message,searchable,allow_contact,branding,created_at,updated_at)
             SELECT ?,?,NULL,?,0,NULL,0,'draft','',1,1,1,?,?
             WHERE NOT EXISTS (SELECT 1 FROM sites WHERE user_id=?)
               AND EXISTS(SELECT 1 FROM dns_names WHERE name=? AND owner_id=? AND site_id IS NULL)`,
          ).bind(siteId, userId, initialDraft, attachedAt, attachedAt, userId, name, userId),
          c.env.DB.prepare(
            `UPDATE dns_names SET site_id=?
             WHERE name=? AND owner_id=? AND site_id IS NULL
               AND EXISTS(SELECT 1 FROM sites WHERE id=? AND user_id=?)`,
          ).bind(siteId, name, userId, siteId, userId),
        ]) as D1ResultLike[];
      } catch {
        apiError(409, 'The profile site and name could not be created', 'NAME_ATTACH_CONFLICT');
      }
      if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
        const current = await one<{ owner_id: number; site_id: string | null }>(c, 'SELECT owner_id,site_id FROM dns_names WHERE name=?', name);
        if (!current || Number(current.owner_id) !== userId) apiError(404, 'You do not own this name', 'NAME_NOT_OWNED');
        if (current.site_id !== null) apiError(409, 'This name was attached by another request', 'NAME_ALREADY_ATTACHED');
        apiError(409, 'A profile site already exists or changed during attachment', 'NAME_ATTACH_CONFLICT');
      }
      createdSite = true;
    }

    const site = await one<SiteRow>(c, 'SELECT * FROM sites WHERE id=? AND user_id=?', siteId, userId);
    if (!site) apiError(409, 'The attached site is no longer available', 'NAME_ATTACH_CONFLICT');
    await audit(c, 'name.attach', name, { siteId, createdSite });
    return c.json({ name, site: toSite({ ...site, name }), createdSite, attachedAt });
  });

  app.get('/api/sites/:id', async (c) => {
    const user = me(c) as unknown as Record<string, unknown>;
    const site = await editableSiteFor(c, c.req.param('id'), user);
    return c.json({ site: toSite(await withSiteName(c, site)) });
  });

  app.put('/api/sites/:id/draft', async (c) => {
    const user = me(c) as unknown as Record<string, unknown>;
    const body = await requestBody(c);
    const site = await editableSiteFor(c, c.req.param('id'), user);
    const version = asInteger(body.version, 'version');
    if (version !== Number(site.draft_version)) {
      apiError(409, 'This draft has changed. Reload before saving.', 'DRAFT_CONFLICT');
    }
    const previous = parseJson<Profile>(site.draft, defaultProfile(String(user.name ?? '')));
    const profile = normalizeProfile(body.draft, previous.name || String(user.name ?? ''));
    await assertProfileMediaEditable(c, profile, Number(user.id), site);
    const updatedAt = now();
    const result = await run(
      c,
      `UPDATE sites SET draft=?,draft_version=draft_version+1,searchable=?,allow_contact=?,updated_at=?
       WHERE id=? AND draft_version=?`,
      JSON.stringify(profile),
      profile.searchable ? 1 : 0,
      profile.allowContact ? 1 : 0,
      updatedAt,
      site.id,
      version,
    );
    if (changes(result) !== 1) apiError(409, 'This draft has changed. Reload before saving.', 'DRAFT_CONFLICT');
    const saved: SiteRow = {
      ...(await withSiteName(c, site)),
      draft: JSON.stringify(profile),
      draft_version: version + 1,
      searchable: profile.searchable ? 1 : 0,
      allow_contact: profile.allowContact ? 1 : 0,
      updated_at: updatedAt,
    };
    if (profile.allowContact) await recordConsent(c, 'contact', 'profile-privacy', true);
    else await withdrawConsent(c, 'contact', 'profile-privacy');
    await audit(c, 'site.draft.save', site.id, { version: saved.draft_version });
    return c.json({ site: toSite(saved), version: saved.draft_version, savedAt: updatedAt });
  });

  app.post('/api/sites/:id/submit', async (c) => {
    const user = me(c) as unknown as Record<string, unknown>;
    const site = await editableSiteFor(c, c.req.param('id'), user);
    const existing = await one<{ id: string }>(
      c,
      "SELECT r.id FROM reviews r LEFT JOIN review_decisions d ON d.review_id=r.id WHERE r.site_id=? AND r.draft_version=? AND r.status='pending' AND d.review_id IS NULL",
      site.id,
      site.draft_version,
    );
    if (existing) apiError(409, 'This draft version is already under review', 'REVIEW_PENDING');

    const reviewId = uid();
    const createdAt = now();
    try {
      const result = await run(
        c,
        `INSERT INTO reviews(id,site_id,user_id,snapshot,draft_version,base_version,status,kind,created_at)
         SELECT ?,id,?,?,?,?,?,'content',?
         FROM sites WHERE id=? AND draft_version=?`,
        reviewId,
        Number(user.id),
        site.draft,
        Number(site.draft_version),
        Number(site.published_version),
        'pending',
        createdAt,
        site.id,
        Number(site.draft_version),
      );
      if (changes(result) !== 1) apiError(409, 'This draft has changed. Reload before submitting.', 'DRAFT_CONFLICT');
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      const pending = await one<{ id: string }>(
        c,
        "SELECT r.id FROM reviews r LEFT JOIN review_decisions d ON d.review_id=r.id WHERE r.site_id=? AND r.draft_version=? AND r.status='pending' AND d.review_id IS NULL",
        site.id,
        site.draft_version,
      );
      if (pending) apiError(409, 'This draft version is already under review', 'REVIEW_PENDING');
      apiError(409, 'The review request could not be created', 'REVIEW_CONFLICT');
    }
    if (!site.published) {
      await run(c, "UPDATE sites SET status='pending',updated_at=? WHERE id=? AND published IS NULL", createdAt, site.id);
    }
    const review = await one<Record<string, unknown>>(c, 'SELECT * FROM reviews WHERE id=?', reviewId);
    if (!review) apiError(500, 'Review request could not be loaded', 'REVIEW_CREATE_FAILED');
    await recordConsent(c, 'public_profile', 'review-submission', true);
    await audit(c, 'site.submit', site.id, { reviewId, draftVersion: site.draft_version });
    return c.json({ review: toReview(review) }, 201);
  });

  app.post('/api/sites/:id/lock', async (c) => {
    const user = me(c) as unknown as Record<string, unknown>;
    const body = await requestBody(c);
    const site = await editableSiteFor(c, c.req.param('id'), user);
    const enabled = asBoolean(body.enabled, 'enabled', false);
    const message = asString(body.message, 'message', 300);
    let lockHash: string | null = null;
    if (enabled) {
      await service(c, 'site_lock', Number(user.id));
      const password = asString(body.password, 'password', 256, true);
      if (password.length < 8) apiError(422, 'Site lock password must be at least 8 characters', 'WEAK_PASSWORD');
      lockHash = await hashSecret(password);
    }
    const updatedAt = now();
    await run(
      c,
      'UPDATE sites SET lock_hash=?,lock_message=?,updated_at=? WHERE id=?',
      lockHash,
      enabled ? message : '',
      updatedAt,
      site.id,
    );
    await audit(c, 'site.lock', site.id, { enabled });
    return c.json({ lock: { enabled, message: enabled ? message : '' }, updatedAt });
  });

  app.post('/api/sites/:id/redirect', async (c) => {
    const user = me(c) as unknown as Record<string, unknown>;
    const body = await requestBody(c);
    const site = await editableSiteFor(c, c.req.param('id'), user);
    const redirect = httpUrl(body.url, 'url');
    if (!redirect) apiError(422, 'url is required', 'VALIDATION');
    const current = parseJson<Profile>(site.draft, defaultProfile(String(user.name ?? '')));
    const draft = normalizeProfile({ ...current, redirect }, current.name || String(user.name ?? ''));
    const reviewId = uid();
    const createdAt = now();
    const nextVersion = Number(site.draft_version) + 1;
    try {
      const results = await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE sites SET draft=?,draft_version=draft_version+1,updated_at=?
           WHERE id=? AND draft_version=?`,
        ).bind(JSON.stringify(draft), createdAt, site.id, site.draft_version),
        c.env.DB.prepare(
          `INSERT INTO reviews(id,site_id,user_id,snapshot,draft_version,base_version,status,kind,created_at)
           SELECT ?,id,?,?,?,?,?,'redirect',?
           FROM sites WHERE id=? AND draft_version=?`,
        ).bind(
          reviewId,
          Number(user.id),
          JSON.stringify(draft),
          nextVersion,
          Number(site.published_version),
          'pending',
          createdAt,
          site.id,
          nextVersion,
        ),
      ]);
      if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
        apiError(409, 'This draft has changed. Reload before requesting redirect.', 'DRAFT_CONFLICT');
      }
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      apiError(409, 'A redirect request for this draft is already pending', 'REVIEW_PENDING');
    }
    const review = await one<Record<string, unknown>>(c, 'SELECT * FROM reviews WHERE id=?', reviewId);
    if (!review) apiError(500, 'Redirect request could not be created', 'REVIEW_CREATE_FAILED');
    await audit(c, 'site.redirect.request', site.id, { reviewId, redirect });
    return c.json({ review: toReview(review), redirect }, 201);
  });

  app.get('/api/services', async (c) => {
    const user = me(c) as unknown as Record<string, unknown>;
    const userId = Number(user.id);
    const rows = await all<Record<string, unknown>>(
      c,
      `SELECT s.*,us.mode AS override_mode,us.until_at AS override_until
       FROM services s LEFT JOIN user_services us ON us.key=s.key AND us.user_id=? ORDER BY s.key`,
      userId,
    );
    return c.json({
      services: await Promise.all(rows.map((row) => toDashboardService(c, row, userId))),
    });
  });

  app.post('/api/wallet/transfer', async (c) => {
    const user = me(c) as unknown as Record<string, unknown>;
    const userId = Number(user.id);
    const body = await requestBody(c);
    const amount = asInteger(body.amount, 'amount', 100, 1000);
    const idempotencyKey = safeIdempotencyKey(body.idempotencyKey);
    const reference = `transfer:${userId}:${idempotencyKey}`;
    // Resolve before checking a replay, so a reused key must describe the same recipient as
    // well as the same amount. This also normalizes C/c recipient identifiers consistently.
    const recipient = await resolveRecipient(c, body.recipient);
    if (recipient.id === userId) apiError(422, 'You cannot transfer points to your own account', 'SELF_TRANSFER');
    const idempotencyConflict = (movement: Record<string, unknown>) => Number(movement.amount) !== amount
      || Number(movement.to_id) !== recipient.id;
    const prior = await one<Record<string, unknown>>(c, 'SELECT * FROM ledger WHERE reference=? AND from_id=?', reference, userId);
    if (prior) {
      if (idempotencyConflict(prior)) apiError(409, 'idempotencyKey was already used with a different transfer amount or recipient', 'IDEMPOTENCY_CONFLICT');
      return c.json({ transfer: { id: prior.id, recipient: `C${prior.to_id}`, amount: Number(prior.amount), reference, createdAt: Number(prior.created_at) }, idempotent: true });
    }

    const createdAt = now();
    const ledgerId = uid();
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          'INSERT INTO ledger(id,from_id,to_id,amount,kind,notes,created_at,reference) VALUES(?,?,?,?,?,?,?,?)',
        ).bind(ledgerId, userId, recipient.id, amount, 'transfer', '', createdAt, reference),
        c.env.DB.prepare('INSERT INTO notifications(id,user_id,title,body,created_at) VALUES(?,?,?,?,?)').bind(
          uid(), userId, 'تم تحويل نقاط الوسط', `تم تحويل ${amount} نقطة إلى C${recipient.id}.`, createdAt,
        ),
        c.env.DB.prepare('INSERT INTO notifications(id,user_id,title,body,created_at) VALUES(?,?,?,?,?)').bind(
          uid(), recipient.id, 'وصلتك نقاط وسط', `تم استلام ${amount} نقطة من C${userId}.`, createdAt,
        ),
      ]);
    } catch {
      const completed = await one<Record<string, unknown>>(c, 'SELECT * FROM ledger WHERE reference=? AND from_id=?', reference, userId);
      if (completed) {
        if (idempotencyConflict(completed)) apiError(409, 'idempotencyKey was already used with a different transfer amount or recipient', 'IDEMPOTENCY_CONFLICT');
        return c.json({ transfer: { id: completed.id, recipient: `C${completed.to_id}`, amount: Number(completed.amount), reference, createdAt: Number(completed.created_at) }, idempotent: true });
      }
      apiError(409, 'Transfer could not be completed. Check your available balance.', 'TRANSFER_FAILED');
    }
    await audit(c, 'wallet.transfer', ledgerId, { to: recipient.id, amount, reference });
    return c.json({
      transfer: { id: ledgerId, recipient: `C${recipient.id}`, amount, reference, createdAt },
      idempotent: false,
    }, 201);
  });

  app.post('/api/wallet/redeem', async (c) => {
    const user = me(c) as unknown as Record<string, unknown>;
    const userId = Number(user.id);
    const body = await requestBody(c);
    const days = asInteger(body.days, 'days', 1, 1_000_000_000);
    const idempotencyKey = safeIdempotencyKey(body.idempotencyKey);
    // The immutable redemption id is user-scoped and is also the ledger's unique reference.
    const redemptionId = `redeem:${userId}:${idempotencyKey}`;
    const prior = await one<Record<string, unknown>>(c, 'SELECT * FROM redemptions WHERE id=? AND user_id=?', redemptionId, userId);
    if (prior) {
      if (Number(prior.days) !== days) apiError(409, 'idempotencyKey was already used with a different number of days', 'IDEMPOTENCY_CONFLICT');
      const account = await one<{ entitlement_until: number }>(c, 'SELECT entitlement_until FROM users WHERE id=?', userId);
      return c.json({ redemption: { id: prior.id, days: Number(prior.days), cost: Number(prior.days) * 100, createdAt: Number(prior.created_at) }, entitlementUntil: Number(account?.entitlement_until ?? 0), idempotent: true });
    }
    const createdAt = now();
    try {
      await c.env.DB.batch([
        c.env.DB.prepare('INSERT INTO redemptions(id,user_id,days,created_at) VALUES(?,?,?,?)').bind(redemptionId, userId, days, createdAt),
        // The redemption trigger moves points and advances the aggregate entitlement first; this
        // statement records that resulting point-backed window in the same atomic D1 batch.
        c.env.DB.prepare(
          `INSERT INTO entitlement_sources(id,user_id,source_kind,starts_at,ends_at,reference,detail,created_by,created_at)
           SELECT ?,?,'points',?,entitlement_until,?,?,NULL,? FROM users WHERE id=?`,
        ).bind(
          `entitlement-points-${redemptionId}`,
          userId,
          createdAt,
          `redemption-${redemptionId}`,
          `${days} point-redemption day(s)`,
          createdAt,
          userId,
        ),
        c.env.DB.prepare('INSERT INTO notifications(id,user_id,title,body,created_at) VALUES(?,?,?,?,?)').bind(
          uid(), userId, 'تم استبدال نقاط الوسط', `تم استبدال ${days * 100} نقطة مقابل ${days} يوم.`, createdAt,
        ),
      ]);
    } catch {
      const completed = await one<Record<string, unknown>>(c, 'SELECT * FROM redemptions WHERE id=? AND user_id=?', redemptionId, userId);
      if (completed) {
        if (Number(completed.days) !== days) apiError(409, 'idempotencyKey was already used with a different number of days', 'IDEMPOTENCY_CONFLICT');
        const account = await one<{ entitlement_until: number }>(c, 'SELECT entitlement_until FROM users WHERE id=?', userId);
        return c.json({ redemption: { id: completed.id, days: Number(completed.days), cost: Number(completed.days) * 100, createdAt: Number(completed.created_at) }, entitlementUntil: Number(account?.entitlement_until ?? 0), idempotent: true });
      }
      apiError(409, 'Redemption could not be completed. Check your available balance.', 'REDEMPTION_FAILED');
    }
    const account = await one<{ entitlement_until: number }>(c, 'SELECT entitlement_until FROM users WHERE id=?', userId);
    await audit(c, 'wallet.redeem', redemptionId, { days, cost: days * 100 });
    return c.json({
      redemption: { id: redemptionId, days, cost: days * 100, createdAt },
      entitlementUntil: Number(account?.entitlement_until ?? 0),
      idempotent: false,
    }, 201);
  });

  app.get('/api/payments/instructions', async (c) => {
    me(c);
    const setting = await one<{ value: string }>(c, "SELECT value FROM settings WHERE key='bank'");
    const bank = bankInstructions(setting?.value);
    if (!bank) {
      return c.json({ available: false, instructions: null, reason: 'Bank transfer intake is not active yet.' });
    }
    return c.json({ available: true, instructions: bank });
  });

  app.post('/api/payments', async (c) => {
    const user = me(c) as unknown as Record<string, unknown>;
    const userId = Number(user.id);
    const body = await requestBody(c);
    const bankSetting = await one<{ value: string }>(c, "SELECT value FROM settings WHERE key='bank'");
    if (!bankInstructions(bankSetting?.value)) {
      apiError(409, 'Bank transfer intake is not active', 'BANK_INTAKE_INACTIVE');
    }
    const amount = body.amount;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== amount * 100) {
      apiError(422, 'amount must be a positive value with at most two decimal places', 'VALIDATION');
    }
    const days = asInteger(body.days, 'days', 1, 1_000_000_000);
    const notes = asString(body.notes, 'notes', 1000);
    const receiptId = asString(body.receiptId, 'receiptId', 160, true);
    const receipt = await one<{ id: string }>(
      c,
      `SELECT id FROM media
       WHERE id=? AND owner_id=? AND purpose='receipt' AND public=0
         AND mime IN ('application/pdf','image/png','image/jpeg','image/webp')`,
      receiptId,
      userId,
    );
    if (!receipt) apiError(422, 'receiptId must reference one of your private receipt files', 'INVALID_RECEIPT');

    const previous = await one<Record<string, unknown>>(c, 'SELECT * FROM payments WHERE user_id=? AND receipt_id=?', userId, receiptId);
    const paymentMatches = (payment: Record<string, unknown>) => Number(payment.amount) === amount
      && Number(payment.days) === days
      && String(payment.notes ?? '') === notes;
    const paymentResponse = (payment: Record<string, unknown>, idempotent: boolean) => ({
      payment: {
        id: payment.id,
        amount: Number(payment.amount),
        days: Number(payment.days),
        receipt_id: payment.receipt_id,
        receiptId: payment.receipt_id,
        status: payment.status,
        notes: payment.notes,
        created_at: Number(payment.created_at),
        createdAt: Number(payment.created_at),
      },
      idempotent,
    });
    if (previous) {
      if (!paymentMatches(previous)) apiError(409, 'receiptId was already used for a different payment request', 'IDEMPOTENCY_CONFLICT');
      return c.json(paymentResponse(previous, true));
    }

    const paymentId = uid();
    const createdAt = now();
    const status = 'submitted';
    try {
      await run(
        c,
        `INSERT INTO payments(id,user_id,amount,days,receipt_id,status,notes,referrer_id,created_at)
         SELECT ?,?,?,?,?,?,?,referrer_id,? FROM users WHERE id=?`,
        paymentId,
        userId,
        amount,
        days,
        receiptId,
        status,
        notes,
        createdAt,
        userId,
      );
    } catch {
      const concurrent = await one<Record<string, unknown>>(c, 'SELECT * FROM payments WHERE user_id=? AND receipt_id=?', userId, receiptId);
      if (concurrent) {
        if (!paymentMatches(concurrent)) apiError(409, 'receiptId was already used for a different payment request', 'IDEMPOTENCY_CONFLICT');
        return c.json(paymentResponse(concurrent, true));
      }
      apiError(409, 'Payment request could not be submitted', 'PAYMENT_CREATE_FAILED');
    }
    const created = { id: paymentId, amount, days, receipt_id: receiptId, status, notes, created_at: createdAt };
    await audit(c, 'payment.create', paymentId, { amount, days, status, hasReceipt: true });
    return c.json(paymentResponse(created, false), 201);
  });

  app.post('/api/quick-links', async (c) => {
    const user = me(c) as unknown as Record<string, unknown>;
    const userId = Number(user.id);
    await service(c, 'quick_link', userId);
    const body = await requestBody(c);
    const mode = body.mode === undefined ? 'professional' : asString(body.mode, 'mode', 32, true).toLowerCase();
    if (!QUICK_LINK_MODES.has(mode)) {
      apiError(422, 'mode must be professional, business, or quick', 'VALIDATION');
    }
    if (!Array.isArray(body.fields) || !body.fields.length || body.fields.length > QUICK_FIELDS.size) {
      apiError(422, 'fields must be a non-empty selection of permitted quick-link fields', 'VALIDATION');
    }
    const fields = body.fields.map((field) => asString(field, 'quick-link field', 32, true));
    if (new Set(fields).size !== fields.length || fields.some((field) => !QUICK_FIELDS.has(field))) {
      apiError(422, 'fields contains an unsupported or duplicate field', 'VALIDATION');
    }
    const expiresDays = asInteger(body.expiresDays, 'expiresDays', 1, 1_000_000);
    const requestedSite=c.req.query('siteId');
    const site = requestedSite?await editableSiteFor(c,requestedSite,user):await primarySite(c, userId);
    if (!site) apiError(409, 'Create a profile site before sharing a quick link', 'SITE_REQUIRED');
    const profile = parseJson<Profile>(site.draft, defaultProfile(String(user.name ?? '')));
    const values: Json = {};
    for (const field of fields) {
      if (field === 'site') {
        if (!site.name) apiError(409, 'Reserve a profile name before sharing a site link', 'NAME_REQUIRED');
        values.site = `https://${site.name}.${c.env.ROOT_DOMAIN}`;
      } else {
        const value = profile[field as keyof Profile];
        if (typeof value !== 'string' || !value) apiError(422, `The selected ${field} field has no value`, 'MISSING_SELECTED_FIELD');
        values[field] = value;
      }
    }
    const createdAt = now();
    const id = uid();
    const expiresAt = createdAt + expiresDays * 86_400;
    // This payload is deliberately independent of hidden fields: the owner explicitly selected every item here.
    const payload = { mode, fields, values };
    await run(c, 'INSERT INTO quick_links(id,user_id,payload,expires_at,revoked,created_at) VALUES(?,?,?,?,0,?)', id, userId, JSON.stringify(payload), expiresAt, createdAt);
    await audit(c, 'quick_link.create', id, { fields, expiresAt });
    return c.json(toQuickLink({ id, payload: JSON.stringify(payload), expires_at: expiresAt, created_at: createdAt, revoked: 0 }, c.env.ROOT_DOMAIN), 201);
  });

  app.post('/api/quick-links/:id/revoke', async (c) => {
    const user = me(c) as unknown as Record<string, unknown>;
    const id = c.req.param('id');
    const result = await run(c, 'UPDATE quick_links SET revoked=1 WHERE id=? AND user_id=? AND revoked=0', id, Number(user.id));
    if (changes(result) !== 1) {
      const exists = await one<{ id: string }>(c, 'SELECT id FROM quick_links WHERE id=? AND user_id=?', id, Number(user.id));
      if (!exists) apiError(404, 'Quick link not found', 'NOT_FOUND');
    }
    await audit(c, 'quick_link.revoke', id, {});
    return c.json({ id, revoked: true });
  });

  app.post('/api/names/transfer', async (c) => {
    const user = me(c) as unknown as Record<string, unknown>;
    await fresh(c);
    const userId = Number(user.id);
    const body = await requestBody(c);
    const name = safeName(body.name);
    const recipient = await resolveRecipient(c, body.recipient);
    if (recipient.id === userId) apiError(422, 'You cannot transfer a name to yourself', 'SELF_TRANSFER');
    const owned = await one<{ name: string; site_id: string | null }>(c, 'SELECT name,site_id FROM dns_names WHERE name=? AND owner_id=?', name, userId);
    if (!owned) apiError(404, 'You do not own this name', 'NAME_NOT_OWNED');
    const pending = await one<{ id: string }>(c, "SELECT id FROM transfers WHERE name=? AND status IN ('pending','accepted')", name);
    if (pending) apiError(409, 'A transfer for this name is already in progress', 'TRANSFER_PENDING');
    const id = uid();
    const createdAt = now();
    try {
      await c.env.DB.batch([
        c.env.DB.prepare('INSERT INTO transfers(id,name,from_id,to_id,status,created_at) VALUES(?,?,?,?,\'pending\',?)').bind(id, name, userId, recipient.id, createdAt),
        c.env.DB.prepare('INSERT INTO notifications(id,user_id,title,body,created_at) VALUES(?,?,?,?,?)').bind(
          uid(), recipient.id, 'طلب نقل اسم مميز', `تمت دعوتك لقبول نقل الاسم ${name}. لا ينقل ذلك الموقع أو المحتوى.`, createdAt,
        ),
        c.env.DB.prepare('INSERT INTO notifications(id,user_id,title,body,created_at) VALUES(?,?,?,?,?)').bind(
          uid(), userId, 'تم إرسال طلب نقل الاسم', `ينتظر الاسم ${name} قبول المستفيد ثم قرار الإدارة.`, createdAt,
        ),
      ]);
    } catch {
      // The partial unique index is the concurrency authority; the preliminary read above is
      // only a friendly fast-path and must not be relied on for correctness.
      const active = await one<{ id: string }>(c, "SELECT id FROM transfers WHERE name=? AND status IN ('pending','accepted')", name);
      if (active) apiError(409, 'A transfer for this name is already in progress', 'TRANSFER_PENDING');
      apiError(409, 'The transfer request could not be created', 'TRANSFER_CONFLICT');
    }
    await audit(c, 'name.transfer.request', name, { transferId: id, to: recipient.id, siteId: owned.site_id });
    return c.json({ transfer: { id, name, recipient: `C${recipient.id}`, status: 'pending', createdAt } }, 201);
  });

  app.post('/api/names/transfers/:id/accept', async (c) => {
    const user = me(c) as unknown as Record<string, unknown>;
    await fresh(c);
    const userId = Number(user.id);
    const id = c.req.param('id');
    const transfer = await one<Record<string, unknown>>(c, 'SELECT * FROM transfers WHERE id=? AND to_id=?', id, userId);
    if (!transfer) apiError(404, 'Transfer not found', 'NOT_FOUND');
    if (transfer.status !== 'pending') apiError(409, 'This transfer is no longer awaiting acceptance', 'TRANSFER_STATE');
    const acceptedAt = now();
    const result = await run(c, "UPDATE transfers SET status='accepted',accepted_at=? WHERE id=? AND to_id=? AND status='pending'", acceptedAt, id, userId);
    if (changes(result) !== 1) apiError(409, 'This transfer changed before it could be accepted', 'TRANSFER_CONFLICT');
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO notifications(id,user_id,title,body,created_at) VALUES(?,?,?,?,?)').bind(
        uid(), Number(transfer.from_id), 'تم قبول طلب نقل الاسم', `قُبل نقل الاسم ${String(transfer.name)} وهو بانتظار اعتماد الإدارة.`, acceptedAt,
      ),
      c.env.DB.prepare('INSERT INTO notifications(id,user_id,title,body,created_at) VALUES(?,?,?,?,?)').bind(
        uid(), userId, 'تم قبول طلب نقل الاسم', `لن ينتقل أي موقع أو محتوى مع الاسم ${String(transfer.name)}.`, acceptedAt,
      ),
    ]);
    await audit(c, 'name.transfer.accept', id, { name: transfer.name, from: transfer.from_id, to: userId });
    return c.json({ transfer: { id, name: transfer.name, status: 'accepted', acceptedAt } });
  });

  app.post('/api/handovers/:id/accept', async (c) => {
    const user = me(c) as unknown as Record<string, unknown>;
    await fresh(c);
    const userId = Number(user.id);
    const id = c.req.param('id');
    const handover = await one<Record<string, unknown>>(c, 'SELECT * FROM handovers WHERE id=?', id);
    if (!handover) apiError(404, 'Handover not found', 'NOT_FOUND');
    if (handover.status !== 'pending') apiError(409, 'This handover is no longer awaiting acceptance', 'HANDOVER_STATE');
    if (String(handover.target_email).trim().toLowerCase() !== String(user.email).trim().toLowerCase()) {
      apiError(403, 'This handover is addressed to another verified account', 'HANDOVER_FORBIDDEN');
    }
    const existing = await primarySite(c, userId);
    if (existing && existing.id !== handover.site_id) {
      apiError(409, 'This account already has a primary profile site', 'PRIMARY_SITE_EXISTS');
    }
    const acceptedAt = now();
    let results: D1ResultLike[];
    try {
      results = await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE handovers SET status='accepted',accepted_by=?,accepted_at=? WHERE id=? AND status='pending' AND lower(target_email)=lower(?)",
        ).bind(userId, acceptedAt, id, String(user.email)),
        c.env.DB.prepare(
          `UPDATE sites SET user_id=?,manager_id=?,updated_at=?
           WHERE id=? AND EXISTS (
             SELECT 1 FROM handovers WHERE id=? AND status='accepted' AND accepted_by=?
           )`,
        ).bind(userId, userId, acceptedAt, String(handover.site_id), id, userId),
      ]) as D1ResultLike[];
    } catch {
      apiError(409, 'The handover could not be completed', 'HANDOVER_CONFLICT');
    }
    if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
      apiError(409, 'This handover changed before it could be accepted', 'HANDOVER_CONFLICT');
    }
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO notifications(id,user_id,title,body,created_at) VALUES(?,?,?,?,?)').bind(
        uid(), Number(handover.creator_id), 'تم قبول تسليم الموقع', `قُبل تسليم إدارة وملكية الموقع ${String(handover.site_id)} بعد تحقق البريد.`, acceptedAt,
      ),
      c.env.DB.prepare('INSERT INTO notifications(id,user_id,title,body,created_at) VALUES(?,?,?,?,?)').bind(
        uid(), userId, 'تم استلام إدارة الموقع', 'انتقلت إليك إدارة وملكية الموقع. لا يشمل ذلك نقل الاسم المميز تلقائياً.', acceptedAt,
      ),
    ]);
    await audit(c, 'site.handover.accept', String(handover.site_id), { handoverId: id, from: handover.creator_id, to: userId, acceptedAt });
    return c.json({ handover: { id, siteId: handover.site_id, status: 'accepted', acceptedAt, owner: `C${userId}`, manager: `C${userId}` } });
  });

  app.post('/api/privacy/hide', async (c) => {
    const result = await hideMyPublicPresence(c);
    return c.json({ ok: true, ...result });
  });

  app.post('/api/deletion-request', async (c) => {
    const body = await requestBody(c);
    const action = body.action === undefined ? 'archive' : asString(body.action, 'action', 16, true).toLowerCase();
    if (!['hide','archive','schedule','destroy'].includes(action)) apiError(422, 'Unsupported privacy action', 'INVALID_ACTION');
    const scheduledFor = body.scheduledFor === undefined || body.scheduledFor === null ? undefined : asInteger(body.scheduledFor, 'scheduledFor', now()+1);
    const result = await requestDeletionLifecycle(c, action as 'hide'|'archive'|'schedule'|'destroy', asString(body.reason, 'reason', 1000), scheduledFor, body.affirmation === true);
    return c.json(result, result.idempotent ? 200 : 201);
  });
  app.get('/api/analytics', async (c) => {
    const user = me(c) as unknown as Record<string, unknown>;
    const userId = Number(user.id);
    await service(c, 'analytics', userId);
    const requestedSite=c.req.query('siteId');
    const site = requestedSite?await editableSiteFor(c,requestedSite,user):await primarySite(c, userId);
    if (!site) {
      return c.json({ siteId: null, periodDays: 30, events: { visits: 0, contactClicks: 0, vcardDownloads: 0, qrInteractions: 0, total: 0, byEvent: {} }, activity: { last7Days: 0, last30Days: 0 }, quality: quality(defaultProfile(String(user.name ?? ''))) });
    }
    const current = now();
    const since30 = current - 30 * 86_400;
    const since7 = current - 7 * 86_400;
    const [events, totals] = await Promise.all([
      all<{ event: string; count: number }>(c, 'SELECT event,COUNT(*) AS count FROM analytics WHERE site_id=? AND created_at>=? GROUP BY event', site.id, since30),
      one<{ last7: number; last30: number }>(
        c,
        'SELECT SUM(CASE WHEN created_at>=? THEN 1 ELSE 0 END) AS last7,COUNT(*) AS last30 FROM analytics WHERE site_id=? AND created_at>=?',
        since7,
        site.id,
        since30,
      ),
    ]);
    const byEvent: Record<string, number> = {};
    for (const event of events) byEvent[event.event] = Number(event.count);
    const visits = (byEvent.visit ?? 0) + (byEvent.page_view ?? 0);
    const contactClicks = (byEvent.contact_click ?? 0) + (byEvent.contact ?? 0);
    const vcardDownloads = (byEvent.vcard_download ?? 0) + (byEvent.vcard ?? 0);
    const qrInteractions = (byEvent.qr ?? 0) + (byEvent.qr_scan ?? 0) + (byEvent.qr_interaction ?? 0);
    const profile = parseJson<Profile>(site.draft, defaultProfile(String(user.name ?? '')));
    return c.json({
      siteId: site.id,
      periodDays: 30,
      events: { visits, contactClicks, vcardDownloads, qrInteractions, total: Number(totals?.last30 ?? 0), byEvent },
      activity: { last7Days: Number(totals?.last7 ?? 0), last30Days: Number(totals?.last30 ?? 0) },
      quality: quality(profile),
    });
  });
}
