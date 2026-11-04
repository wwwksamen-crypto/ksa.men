import { displayCountry } from '../../shared/display-country';
import { itemText, list, record, text, webUrl, socialLink, type ProfileRecord } from '../../shared/profile-content';
import { sanitizeProfile } from '../../shared/profile-visibility';

export type ResumeLanguage = 'ar' | 'en';
export type ResumeBlock = { text: string; kind: 'name' | 'role' | 'contact' | 'heading' | 'entry' | 'body'; keepNext?: boolean; link?: string };
export type ResumeContent = { lang: ResumeLanguage; name: string; blocks: ResumeBlock[] };
export type ResumeContext = { name: string; url: string; lang: ResumeLanguage };
const copy = {
  ar: { summary: 'الملخص المهني', experience: 'الخبرات المهنية', education: 'التعليم', training: 'التدريب والشهادات', skills: 'المهارات', memberships: 'العضويات المهنية', languages: 'اللغات', achievements: 'الإنجازات', timeline: 'المسيرة المهنية', specialty: 'التخصص', email: 'البريد الإلكتروني', phone: 'الهاتف', whatsapp: 'واتساب', location: 'الموقع', links: 'الروابط المهنية', noContent: 'لم تُضف تفاصيل مهنية عامة بعد.' },
  en: { summary: 'Professional Summary', experience: 'Professional Experience', education: 'Education', training: 'Training and Certifications', skills: 'Skills', memberships: 'Professional Memberships', languages: 'Languages', achievements: 'Achievements', timeline: 'Career History', specialty: 'Specialty', email: 'Email', phone: 'Phone', whatsapp: 'WhatsApp', location: 'Location', links: 'Professional Links', noContent: 'No public professional details have been added yet.' },
};

/** Ordering uses only explicit valid dates. Unknown dates retain their relative input order. */
export function resumeDate(value: unknown): number | null {
  const input = text(value).replace(/[٠-٩۰-۹]/g, char => String(char.charCodeAt(0) - (char >= '۰' ? 0x06f0 : 0x0660)));
  const match = /^(\d{4})(?:[-/](\d{1,2})(?:[-/](\d{1,2}))?)?$/.exec(input);
  if (!match) return null;
  const year = Number(match[1]), month = match[2] ? Number(match[2]) : 1, day = match[3] ? Number(match[3]) : 1;
  if (year < 1000 || year > 2999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (match[3] && new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day) return null;
  return year * 10000 + month * 100 + day;
}
export function newestResumeItems(values: unknown[]): unknown[] {
  return values.map((value, index) => ({ value, index, date: resumeDate(record(value).start) ?? resumeDate(record(value).date) ?? resumeDate(record(value).end) }))
    .sort((a, b) => a.date === b.date ? a.index - b.index : a.date === null ? 1 : b.date === null ? -1 : b.date - a.date)
    .map(row => row.value);
}

export function buildResumeContent(input: ProfileRecord, context: ResumeContext): ResumeContent {
  const profile = sanitizeProfile(input), labels = copy[context.lang];
  const name = text(profile.name) || context.name;
  const blocks: ResumeBlock[] = [{ text: name, kind: 'name', keepNext: true }];
  const add = (value: string, kind: ResumeBlock['kind'], keepNext = false, link?: string) => { if (value) blocks.push({ text: value, kind, ...(keepNext ? { keepNext: true } : {}), ...(link ? { link } : {}) }); };
  add(text(profile.title), 'role');
  if (text(profile.specialty)) add(`${labels.specialty}: ${text(profile.specialty)}`, 'body');
  for (const key of ['email', 'phone', 'whatsapp'] as const) if (text(profile[key])) { add(`${labels[key]}:`, 'body', true); add(text(profile[key]), 'contact'); }
  const location = [text(profile.city), displayCountry(profile.country, context.lang)].filter(Boolean).join(context.lang === 'ar' ? '، ' : ', ');
  if (location) add(`${labels.location}: ${location}`, 'contact');
  const publicUrl = webUrl(context.url); if (publicUrl) add(publicUrl, 'contact', false, publicUrl);
  if (text(profile.bio)) { add(labels.summary, 'heading', true); add(text(profile.bio), 'body'); }
  for (const key of ['experience', 'education', 'training', 'achievements', 'skills', 'memberships', 'languages', 'timeline'] as const) {
    const source = list(profile[key]);
    const rows = ['experience', 'education', 'training', 'timeline'].includes(key) ? newestResumeItems(source) : source;
    const content: ResumeBlock[] = [];
    for (const value of rows) {
      if (typeof value === 'string') { if (text(value)) content.push({ text: text(value), kind: 'body' }); continue; }
      const row = record(value);
      const title = [row.title, row.label, row.name, row.value, row.language, row.skill].map(text).find(Boolean) || '';
      const organization = text(row.organization) || text(row.institution);
      const period = [text(row.start) || text(row.date), text(row.end)].filter(Boolean).join(' – ');
      const detail = text(row.description) || text(row.level) || text(row.proficiency);
      const parts = [title, organization !== title ? organization : '', period, detail !== title ? detail : ''].filter(Boolean);
      if (!parts.length) { const fallback = itemText(value); if (fallback) content.push({ text: fallback, kind: 'body' }); }
      parts.forEach((part, index) => content.push({ text: part, kind: index === 0 && title ? 'entry' : 'body', ...(index < Math.min(2, parts.length - 1) ? { keepNext: true } : {}) }));
    }
    if (content.length) { add(labels[key], 'heading', true); blocks.push(...content); }
  }
  const links = [...list(profile.socials).map(socialLink).filter(value => value && ['linkedin', 'github', 'website'].includes(value.brand)), ...list(profile.buttons).map(value => { const row = record(value), url = webUrl(row.url); return url ? { label: text(row.label) || text(row.title) || new URL(url).hostname, url } : null; })];
  const unique = [...new Map(links.filter((value): value is NonNullable<typeof value> => Boolean(value)).map(value => [value.url, value])).values()];
  if (unique.length) { add(labels.links, 'heading', true); for (const link of unique) { add(link.label, 'entry', true); add(link.url, 'contact', false, link.url); } }
  if (blocks.length === 1) add(labels.noContent, 'body');
  return { lang: context.lang, name, blocks };
}

/** Logical Unicode alternative: no visual reordering, invisible keyword stuffing, or omitted sections. */
export function resumePlainText(resume: ResumeContent): string {
  return resume.blocks.map(block => block.text).join('\n\n') + '\n';
}
