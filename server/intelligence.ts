import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { all, audit, me, now, one, role, run, service, siteFor, type App, type Env } from './core';

const MODEL = '@cf/meta/m2m100-1.2b';
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const FEED_TIMEOUT_MS = 15_000;
const MAX_FEED_BYTES = 1_500_000;
const MAX_ITEMS_PER_FEED = 50;
const MAX_RADAR_ITEMS = 100;
const DAILY_CHARACTER_LIMIT = 50_000;
const DAILY_NEURON_LIMIT = 4_000;
const TRANSLATION_CHUNK_SIZE = 800;

type JsonRecord = Record<string, unknown>;
type RadarSource = {
  id: string;
  name: string;
  url: string;
  category: string;
  region: string;
  enabled: number;
  last_fetched: number | null;
  last_error: string | null;
};
type RadarItem = {
  title: string;
  link: string;
  published_at: number;
};
type TranslationField = { path: Array<string | number>; text: string };
type ProtectedText = { text: string; markers: Map<string, string> };

type RadarRefreshResult = {
  processed: number;
  inserted: number;
  errors: number;
  updatedAt: number;
};

const translationRequest = z.object({
  siteId: z.string().uuid(),
  target: z.enum(['en', 'ar']),
  consent: z.literal(true),
});

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  cdataPropName: '#cdata',
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
  htmlEntities: false,
  removeNSPrefix: true,
});

const translatableRootFields = new Set(['title', 'bio', 'city', 'country']);
const translatableSimpleLists = new Set(['skills', 'hobbies']);
const translatableStructuredLists = new Set(['experience', 'education', 'training', 'timeline']);
const qualificationLists = new Set(['education', 'training']);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (!isRecord(value)) return '';
  for (const key of ['#text', '#cdata', '__cdata', 'text']) {
    const result = value[key];
    if (typeof result === 'string' || typeof result === 'number') return String(result);
  }
  return '';
}

function cleanText(value: unknown, limit = 500): string {
  return textOf(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function canonicalHttpUrl(value: unknown, base?: string): string | null {
  const raw = cleanText(value, 4_000);
  if (!raw) return null;
  try {
    const url = new URL(raw, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    const retainedQuery = [...url.searchParams.entries()].filter(([key]) => {
      const normalized = key.toLowerCase();
      return !normalized.startsWith('utm_') && !['fbclid', 'gclid'].includes(normalized);
    });
    url.search = new URLSearchParams(retainedQuery).toString();
    return url.href;
  } catch {
    return null;
  }
}

function safeFeedUrl(value: string): string | null {
  const url = canonicalHttpUrl(value);
  if (!url) return null;
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname === 'localhost' || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(parsed.hostname)) return null;
  return parsed.href;
}

function dateSeconds(value: unknown): number | null {
  const raw = cleanText(value, 200);
  if (!raw) return null;
  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds)) return null;
  return Math.floor(milliseconds / 1_000);
}

function rssLink(entry: JsonRecord, feedUrl: string): string | null {
  const link = entry.link;
  if (Array.isArray(link)) {
    for (const item of link) {
      const candidate = isRecord(item) ? item['@_href'] ?? item['#text'] : item;
      const result = canonicalHttpUrl(candidate, feedUrl);
      if (result) return result;
    }
    return null;
  }
  const candidate = isRecord(link) ? link['@_href'] ?? link['#text'] : link;
  return canonicalHttpUrl(candidate, feedUrl);
}

function atomLink(entry: JsonRecord, feedUrl: string): string | null {
  const links = asArray(entry.link);
  const ordered = [...links].sort((a, b) => {
    const aAlternate = isRecord(a) && (a['@_rel'] === 'alternate' || !a['@_rel']);
    const bAlternate = isRecord(b) && (b['@_rel'] === 'alternate' || !b['@_rel']);
    return Number(bAlternate) - Number(aAlternate);
  });
  for (const link of ordered) {
    const candidate = isRecord(link) ? link['@_href'] ?? link['#text'] : link;
    const result = canonicalHttpUrl(candidate, feedUrl);
    if (result) return result;
  }
  return null;
}

/** Parses only RSS 2.0 and Atom metadata; it never reads article bodies, quotes, or media. */
export function processFeedXML(xml: string, feedUrl: string, fetchedAt = now()): RadarItem[] {
  if (!xml || xml.length > MAX_FEED_BYTES) throw new Error('feed_too_large');
  const validation = XMLValidator.validate(xml, { allowBooleanAttributes: true });
  if (validation !== true) throw new Error('feed_parse_error');

  let document: JsonRecord;
  try {
    const parsed = xmlParser.parse(xml);
    if (!isRecord(parsed)) throw new Error('feed_parse_error');
    document = parsed;
  } catch {
    throw new Error('feed_parse_error');
  }

  const cutoff = fetchedAt - WEEK_SECONDS;
  const latestAllowed = fetchedAt + 24 * 60 * 60;
  const candidates: RadarItem[] = [];
  const rss = isRecord(document.rss) ? document.rss : null;
  const atom = isRecord(document.feed) ? document.feed : null;

  if (rss) {
    const channel = isRecord(rss.channel) ? rss.channel : null;
    for (const entry of asArray(channel?.item).filter(isRecord)) {
      const title = cleanText(entry.title);
      const link = rssLink(entry, feedUrl);
      const publishedAt = dateSeconds(entry.pubDate ?? entry.date ?? entry.published ?? entry.updated);
      if (title && link && publishedAt !== null && publishedAt >= cutoff && publishedAt <= latestAllowed) {
        candidates.push({ title, link, published_at: publishedAt });
      }
    }
  } else if (atom) {
    for (const entry of asArray(atom.entry).filter(isRecord)) {
      const title = cleanText(entry.title);
      const link = atomLink(entry, feedUrl);
      const publishedAt = dateSeconds(entry.published ?? entry.updated ?? entry.issued);
      if (title && link && publishedAt !== null && publishedAt >= cutoff && publishedAt <= latestAllowed) {
        candidates.push({ title, link, published_at: publishedAt });
      }
    }
  } else {
    throw new Error('feed_unsupported');
  }

  const deduplicated = new Map<string, RadarItem>();
  for (const item of candidates) if (!deduplicated.has(item.link)) deduplicated.set(item.link, item);
  return [...deduplicated.values()]
    .sort((a, b) => b.published_at - a.published_at)
    .slice(0, MAX_ITEMS_PER_FEED);
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (['feed_too_large', 'feed_parse_error', 'feed_unsupported'].includes(message)) return message;
  if (message.startsWith('feed_http_')) return message;
  if (message === 'feed_timeout') return message;
  return 'feed_fetch_error';
}

async function fetchFeed(source: RadarSource, fetchedAt: number): Promise<RadarItem[]> {
  const feedUrl = safeFeedUrl(source.url);
  if (!feedUrl) throw new Error('feed_invalid_url');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const response = await fetch(feedUrl, {
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9',
        'User-Agent': 'KSA-MEN-Radar/1.0 (+https://ksa.men)',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`feed_http_${response.status}`);
    const declaredSize = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredSize) && declaredSize > MAX_FEED_BYTES) throw new Error('feed_too_large');
    const xml = await response.text();
    return processFeedXML(xml, feedUrl, fetchedAt);
  } catch (error) {
    if (controller.signal.aborted) throw new Error('feed_timeout');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetches configured publisher feeds and records only real, recent RSS/Atom metadata. */
export async function fetchRadar(env: Env): Promise<RadarRefreshResult> {
  const fetchedAt = now();
  const sources = (await env.DB.prepare(
    'SELECT id,name,url,category,region,enabled,last_fetched,last_error FROM radar_sources WHERE enabled=1 ORDER BY id',
  ).all<RadarSource>()).results;
  let inserted = 0;
  let errors = 0;

  for (const source of sources) {
    try {
      const items = await fetchFeed(source, fetchedAt);
      const statements = items.map((item) => env.DB.prepare(
        `INSERT OR IGNORE INTO radar_items(id,title,url,source_id,category,region,published_at,created_at)
         VALUES(?,?,?,?,?,?,?,?)`,
      ).bind(crypto.randomUUID(), item.title, item.link, source.id, source.category, source.region, item.published_at, fetchedAt));
      statements.push(env.DB.prepare(
        'UPDATE radar_sources SET last_fetched=?,last_error=NULL WHERE id=?',
      ).bind(fetchedAt, source.id));
      const results = await env.DB.batch(statements);
      inserted += results.slice(0, -1).reduce((sum, result) => sum + Number(result.meta.changes ?? 0), 0);
    } catch (error) {
      errors += 1;
      await env.DB.prepare('UPDATE radar_sources SET last_error=? WHERE id=?').bind(errorCode(error), source.id).run();
      console.warn('Radar feed refresh failed', source.id, errorCode(error));
    }
  }

  return { processed: sources.length, inserted, errors, updatedAt: fetchedAt };
}

function radarStatus(sources: Array<Pick<RadarSource, 'last_fetched' | 'last_error'>>, updatedAt: number | null): 'fresh' | 'stale' | 'unavailable' | 'empty' {
  if (!sources.length) return 'empty';
  if (updatedAt && updatedAt >= now() - 7 * 60 * 60) return 'fresh';
  if (updatedAt) return 'stale';
  return 'unavailable';
}

function cloneProfile(value: unknown): JsonRecord {
  if (!isRecord(value)) return {};
  const { translations: _translations, ...profile } = structuredClone(value);
  return profile;
}

function getPath(value: unknown, path: Array<string | number>): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
    } else {
      if (!isRecord(current)) return undefined;
      current = current[segment];
    }
  }
  return current;
}

function setPath(value: JsonRecord, path: Array<string | number>, next: string): void {
  let current: JsonRecord | unknown[] = value;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    const following = path[index + 1];
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return;
      if (!isRecord(current[segment]) && !Array.isArray(current[segment])) current[segment] = typeof following === 'number' ? [] : {};
      current = current[segment] as JsonRecord | unknown[];
    } else {
      if (!isRecord(current)) return;
      if (!isRecord(current[segment]) && !Array.isArray(current[segment])) current[segment] = typeof following === 'number' ? [] : {};
      current = current[segment] as JsonRecord | unknown[];
    }
  }
  const finalSegment = path[path.length - 1];
  if (typeof finalSegment === 'number' && Array.isArray(current)) current[finalSegment] = next;
  if (typeof finalSegment === 'string' && isRecord(current)) current[finalSegment] = next;
}

function collectTranslationFields(profile: JsonRecord): TranslationField[] {
  const fields: TranslationField[] = [];
  for (const key of translatableRootFields) {
    if (typeof profile[key] === 'string' && profile[key].trim()) fields.push({ path: [key], text: profile[key] });
  }
  for (const key of translatableSimpleLists) {
    for (const [index, value] of asArray(profile[key]).entries()) {
      if (typeof value === 'string' && value.trim()) fields.push({ path: [key, index], text: value });
    }
  }
  for (const key of translatableStructuredLists) {
    for (const [index, value] of asArray(profile[key]).entries()) {
      if (!isRecord(value)) continue;
      // Education and training titles are official qualifications. They and all organisations stay exact.
      if (!qualificationLists.has(key) && typeof value.title === 'string' && value.title.trim()) {
        fields.push({ path: [key, index, 'title'], text: value.title });
      }
      if (typeof value.description === 'string' && value.description.trim()) {
        fields.push({ path: [key, index, 'description'], text: value.description });
      }
    }
  }
  return fields;
}

function protectedTerms(profile: JsonRecord): string[] {
  const terms = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.trim().length >= 3) terms.add(value.trim());
  };
  add(profile.name);
  for (const list of ['experience', 'education', 'training']) {
    for (const entry of asArray(profile[list])) if (isRecord(entry)) {
      add(entry.organization);
      if (qualificationLists.has(list)) add(entry.title);
    }
  }
  for (const list of ['memberships', 'achievements']) for (const entry of asArray(profile[list])) add(entry);
  return [...terms].sort((a, b) => b.length - a.length);
}

function protectText(text: string, terms: string[]): ProtectedText {
  const markers = new Map<string, string>();
  let protectedText = text;
  for (const term of terms) {
    if (!protectedText.includes(term)) continue;
    const marker = `[[KSAKEEP${markers.size}]]`;
    protectedText = protectedText.split(term).join(marker);
    markers.set(marker, term);
  }
  return { text: protectedText, markers };
}

function restoreProtectedText(text: string, protectedText: ProtectedText): string {
  let restored = text;
  for (const [marker, term] of protectedText.markers) {
    const flexibleMarker = new RegExp(`\\[\\[\\s*${marker.slice(2, -2).replace(/([.*+?^${}()|[\]\\])/g, '\\$1').replace('KEEP', '\\s*KEEP\\s*')}\\s*\\]\\]`, 'gi');
    restored = restored.replace(flexibleMarker, term);
    if (!restored.includes(term)) throw new HTTPException(502, { message: 'تعذر الحفاظ على الاسم أو المؤهل الرسمي أثناء الترجمة' });
  }
  return restored;
}

function splitText(text: string): string[] {
  if (text.length <= TRANSLATION_CHUNK_SIZE) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > TRANSLATION_CHUNK_SIZE) {
    let end = remaining.lastIndexOf(' ', TRANSLATION_CHUNK_SIZE);
    if (end < Math.floor(TRANSLATION_CHUNK_SIZE * 0.6)) end = TRANSLATION_CHUNK_SIZE;
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function translateText(env: Env, text: string, sourceLang: 'ar' | 'en', targetLang: 'ar' | 'en', terms: string[]): Promise<string> {
  const translated: string[] = [];
  for (const chunk of splitText(text)) {
    const protectedChunk = protectText(chunk, terms);
    let response: { translated_text?: unknown };
    try {
      response = await env.AI.run(MODEL, {
        text: protectedChunk.text,
        source_lang: sourceLang,
        target_lang: targetLang,
      }) as { translated_text?: unknown };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/quota|neuron|limit/i.test(message)) {
        throw new HTTPException(429, { message: 'تم بلوغ حصة Workers AI المجانية المشتركة لهذا الحساب اليوم' });
      }
      throw new HTTPException(502, { message: 'تعذرت الترجمة الآلية الآمنة، حاول لاحقًا' });
    }
    if (typeof response.translated_text !== 'string' || !response.translated_text.trim()) {
      throw new HTTPException(502, { message: 'لم تُرجع خدمة الترجمة نصًا صالحًا' });
    }
    translated.push(restoreProtectedText(response.translated_text, protectedChunk));
  }
  return translated.join('');
}

function translationSource(draft: JsonRecord, target: 'ar' | 'en'): { source: JsonRecord; existing: JsonRecord | undefined; sourceLang: 'ar' | 'en' } {
  const translations = isRecord(draft.translations) ? draft.translations : {};
  const sourceVariant = target === 'en' ? translations.ar : translations.en;
  return {
    source: cloneProfile(isRecord(sourceVariant) ? sourceVariant : draft),
    existing: isRecord(translations[target]) ? cloneProfile(translations[target]) : undefined,
    sourceLang: target === 'en' ? 'ar' : 'en',
  };
}

function estimatedNeurons(characters: number): number {
  // 50,000 characters maps to at most 4,000 estimated neurons, below the 10,000/day included allowance.
  return Math.ceil((characters * 2) / 25);
}

async function reserveTranslationQuota(env: Env, characters: number): Promise<boolean> {
  const dayStart = Math.floor(now() / 86_400) * 86_400;
  const neurons = estimatedNeurons(characters);
  if (characters <= 0 || characters > DAILY_CHARACTER_LIMIT || neurons > DAILY_NEURON_LIMIT) return false;
  await env.DB.prepare(
    `INSERT INTO intelligence_usage(day_start,service_key,characters,estimated_neurons,created_at,updated_at)
     VALUES(?,?,?,?,?,?)
     ON CONFLICT(day_start,service_key) DO NOTHING`,
  ).bind(dayStart, 'translation', 0, 0, now(), now()).run();
  const result = await env.DB.prepare(
    `UPDATE intelligence_usage
     SET characters=characters+?, estimated_neurons=estimated_neurons+?, updated_at=?
     WHERE day_start=? AND service_key='translation'
       AND characters+?<=? AND estimated_neurons+?<=?`,
  ).bind(characters, neurons, now(), dayStart, characters, DAILY_CHARACTER_LIMIT, neurons, DAILY_NEURON_LIMIT).run();
  return Number(result.meta.changes ?? 0) === 1;
}

export function registerIntelligence(app: App): void {
  app.get('/api/radar', async (c) => {
    me(c);
    await service(c, 'radar');
    const cutoff = now() - WEEK_SECONDS;
    const [items, sources] = await Promise.all([
      all<{
        id: string; title: string; link: string; published_date: number; source: string; source_url: string; category: string; region: string;
      }>(c,
        `SELECT i.id,i.title,i.url AS link,i.published_at AS published_date,s.name AS source,s.url AS source_url,i.category,i.region
         FROM radar_items i JOIN radar_sources s ON s.id=i.source_id
         WHERE i.published_at>=? ORDER BY i.published_at DESC LIMIT ?`,
        cutoff,
        MAX_RADAR_ITEMS,
      ),
      all<RadarSource>(c,
        'SELECT id,name,url,category,region,enabled,last_fetched,last_error FROM radar_sources WHERE enabled=1 ORDER BY name',
      ),
    ]);
    const updatedAt = sources.reduce<number | null>((latest, source) => Math.max(latest ?? 0, Number(source.last_fetched ?? 0)) || null, null);
    return c.json({
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        link: item.link,
        published_date: Number(item.published_date),
        source: item.source,
        sourceURL: item.source_url,
        category: item.category,
        region: item.region,
      })),
      sources: sources.map((source) => ({
        id: source.id,
        name: source.name,
        url: source.url,
        category: source.category,
        region: source.region,
        lastFetched: source.last_fetched === null ? null : Number(source.last_fetched),
        lastError: source.last_error,
      })),
      updatedAt,
      status: radarStatus(sources, updatedAt),
    });
  });

  app.post('/api/admin/radar/refresh', async (c) => {
    const user = role(c, ['owner', 'manager']);
    const result = await fetchRadar(c.env);
    await audit(c, 'radar.refresh', 'all', { ...result, requestedBy: user.id });
    return c.json({ status: result.errors ? 'partial' : 'ok', ...result });
  });

  app.post('/api/translate', async (c) => {
    const user = me(c);
    await service(c, 'translation');
    const request = translationRequest.parse(await c.req.json());
    const site = await siteFor(c, request.siteId) as { id: string; draft: string; draft_version: number; searchable: number; allow_contact: number };
    let draft: JsonRecord;
    try {
      const parsed = JSON.parse(site.draft);
      if (!isRecord(parsed)) throw new Error('not an object');
      draft = parsed;
    } catch {
      throw new HTTPException(409, { message: 'مسودة الملف غير صالحة للترجمة' });
    }

    const { source, existing, sourceLang } = translationSource(draft, request.target);
    const targetProfile = cloneProfile(source);
    const fields = collectTranslationFields(source);
    const pending = fields.filter((field) => typeof getPath(existing, field.path) !== 'string' || !(getPath(existing, field.path) as string).trim());

    for (const field of fields) {
      const current = getPath(existing, field.path);
      if (typeof current === 'string' && current.trim()) setPath(targetProfile, field.path, current);
    }

    if (!pending.length) {
      return c.json({ draft, version: Number(site.draft_version), translated: true });
    }

    const characterCount = pending.reduce((sum, field) => sum + field.text.length, 0);
    if (characterCount > DAILY_CHARACTER_LIMIT || estimatedNeurons(characterCount) > DAILY_NEURON_LIMIT) {
      return c.json({ error: 'النص أكبر من الحد اليومي المجاني للترجمة', code: 'TRANSLATION_REQUEST_TOO_LARGE' }, 413);
    }
    if (!await reserveTranslationQuota(c.env, characterCount)) {
      return c.json({ error: 'تم بلوغ الحد اليومي المجاني للترجمة لهذه المنصة', code: 'TRANSLATION_QUOTA_EXCEEDED' }, 429);
    }

    const protectedProfileTerms = protectedTerms(source);
    for (const field of pending) {
      const translated = await translateText(c.env, field.text, sourceLang, request.target, protectedProfileTerms);
      setPath(targetProfile, field.path, translated);
    }

    const translations = isRecord(draft.translations) ? structuredClone(draft.translations) : {};
    translations[request.target] = targetProfile;
    const nextDraft = { ...draft, translations };
    const updatedAt = now();
    const result = await run(
      c,
      `UPDATE sites SET draft=?,draft_version=draft_version+1,updated_at=?
       WHERE id=? AND draft_version=?`,
      JSON.stringify(nextDraft),
      updatedAt,
      site.id,
      Number(site.draft_version),
    );
    if (Number(result.meta.changes ?? 0) !== 1) {
      throw new HTTPException(409, { message: 'تغيرت المسودة أثناء الترجمة. أعد المحاولة على أحدث نسخة.' });
    }
    const version = Number(site.draft_version) + 1;
    await audit(c, 'site.translate', site.id, {
      target: request.target,
      version,
      characters: characterCount,
      estimatedNeurons: estimatedNeurons(characterCount),
      consent: true,
      userId: user.id,
    });
    return c.json({ draft: nextDraft, version, translated: true });
  });
}
