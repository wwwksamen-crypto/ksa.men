export type ProfileRecord = Record<string, unknown>;
export function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
export function record(value: unknown): ProfileRecord { return value && typeof value === 'object' && !Array.isArray(value) ? value as ProfileRecord : {}; }
export function list(value: unknown): unknown[] { return Array.isArray(value) ? value : typeof value === 'string' && value.trim() ? [value] : []; }
export function itemText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  const item = record(value);
  const label = ['label', 'name', 'title', 'value', 'language', 'skill', 'organization', 'institution'].map(key => text(item[key])).find(Boolean) || '';
  const detail = text(item.level) || text(item.proficiency) || text(item.description);
  const organization = text(item.organization) || text(item.institution);
  const period = [text(item.start) || text(item.date), text(item.end)].filter(Boolean).join(' – ');
  return [label, organization && organization !== label ? organization : '', period, detail && detail !== label ? detail : ''].filter(Boolean).join(' — ');
}
/** Normalize HTTP(S) only. A bare hostname is allowed; scripts, credentials and ambiguous relative URLs are not. */
export function webUrl(value: unknown): string {
  const input = text(value);
  if (!input || input.length > 2048 || /[\u0000-\u0020\u007f]/.test(input)) return '';
  const raw = /^[a-z][a-z\d+.-]*:/i.test(input) ? input : /^(?:[\w-]+\.)+[\w-]+(?::\d+)?(?:[/?#]|$)/.test(input) ? `https://${input}` : '';
  if (!raw) return '';
  try { const url = new URL(raw); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
export type SocialBrand = 'x' | 'youtube' | 'linkedin' | 'instagram' | 'facebook' | 'github' | 'whatsapp' | 'telegram' | 'snapchat' | 'tiktok' | 'threads' | 'website';
const domains: Array<[SocialBrand, string[]]> = [
  ['x', ['x.com', 'twitter.com']], ['youtube', ['youtube.com', 'youtu.be', 'youtube-nocookie.com']],
  ['linkedin', ['linkedin.com']], ['instagram', ['instagram.com']], ['facebook', ['facebook.com', 'fb.com']],
  ['github', ['github.com']], ['whatsapp', ['wa.me', 'whatsapp.com']], ['telegram', ['t.me', 'telegram.me']],
  ['snapchat', ['snapchat.com']], ['tiktok', ['tiktok.com']], ['threads', ['threads.net', 'threads.com']],
];
export const brandNames: Record<SocialBrand, string> = { x: 'X', youtube: 'YouTube', linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook', github: 'GitHub', whatsapp: 'WhatsApp', telegram: 'Telegram', snapchat: 'Snapchat', tiktok: 'TikTok', threads: 'Threads', website: 'Website' };
export function socialLink(value: unknown): { url: string; label: string; brand: SocialBrand; host: string } | null {
  const item = record(value);
  const url = webUrl(typeof value === 'string' ? value : item.url || item.href);
  if (!url) return null;
  const host = new URL(url).hostname.toLowerCase();
  const brand = domains.find(([, roots]) => roots.some(root => host === root || host.endsWith(`.${root}`)))?.[0] || 'website';
  return { url, label: text(item.label) || text(item.title) || (brand === 'website' ? host.replace(/^www\./, '') : brandNames[brand]), brand, host };
}
export type YoutubeLink = { kind: 'video'; id: string; url: string } | { kind: 'channel'; url: string };
export function youtubeLink(value: unknown): YoutubeLink | null {
  const safe = webUrl(value);
  if (!safe) return null;
  const url = new URL(safe), host = url.hostname.toLowerCase();
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  let handle = ''; try { handle = decodeURIComponent(parts[0] || ''); } catch { return null; }
  const id = host === 'youtu.be' ? parts[0] : url.pathname === '/watch' ? url.searchParams.get('v') : ['embed', 'shorts', 'live', 'v'].includes(parts[0]) ? parts[1] : null;
  if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return { kind: 'video', id, url: `https://www.youtube.com/watch?v=${id}` };
  if (host !== 'youtu.be' && (parts.length === 0 || /^@[\p{L}\p{N}_.-]+$/u.test(handle) || ['channel', 'c', 'user'].includes(parts[0]) && Boolean(parts[1]))) return { kind: 'channel', url: safe };
  return null;
}
export function mediaSource(value: unknown): string {
  const input = typeof value === 'string' ? value : record(value).url;
  return typeof input === 'string' && (/^\/api\/media\/[A-Za-z\d_-]+$/.test(input) || /^\/assets\/[A-Za-z\d_.-]+(?:\?rev=[A-Za-z\d_-]+)?$/.test(input)) ? input : '';
}
