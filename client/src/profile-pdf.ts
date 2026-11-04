import type { Content, ContentText, Column, TDocumentDefinitions } from 'pdfmake/interfaces';
import { itemText, list, mediaSource, record, socialLink, text, webUrl } from '../../shared/profile-content';
import { sanitizeProfile } from '../../shared/profile-visibility';

export const PROFILE_PDF_LOGO = '/assets/logo-emblem.webp';
export const PROFILE_PDF_COVER = '/assets/cover-1600.webp';
export type PdfImageAsset = { data: string; width: number; height: number };
export type ProfilePdfAssets = { portrait: PdfImageAsset; cover: PdfImageAsset; evidence: Record<string, PdfImageAsset>; unavailable: string[] };
export type PdfTextFormatter = (value: string, rtl: boolean, width?: number, size?: number) => ContentText['text'];
export type ProfilePdfContext = { name: string; url: string; lang: 'ar' | 'en' };
export type ProfilePdfSection = { key: string; heading: string; entries: Array<{ heading: string; organization: string; period: string; description: string }> };
const GREEN = '#005A35', INK = '#17382B', MUTED = '#5C7167', GOLD = '#AD874B';
const PAGE_WIDTH = 841.89, FRAME_WIDTH = PAGE_WIDTH - 80;

const copy = {
  ar: { profile: 'الملف المهني', summary: 'نبذة مهنية', experience: 'الخبرات', education: 'التعليم', training: 'التدريب', skills: 'المهارات', memberships: 'العضويات', languages: 'اللغات', hobbies: 'الاهتمامات', achievements: 'الإنجازات', timeline: 'المسار المهني', skillImages: 'شواهد المهارات', workImages: 'نماذج الأعمال', human: 'المهارات الإنسانية', scientific: 'المهارات العلمية', professional: 'المهارات المهنية', links: 'روابط التواصل والأعمال', blog: 'مدونتي', unavailable: 'الصورة غير متاحة', page: 'صفحة' },
  en: { profile: 'Professional profile', summary: 'Professional summary', experience: 'Experience', education: 'Education', training: 'Training', skills: 'Skills', memberships: 'Memberships', languages: 'Languages', hobbies: 'Interests', achievements: 'Achievements', timeline: 'Career journey', skillImages: 'Skill evidence', workImages: 'Selected work', human: 'Human skills', scientific: 'Scientific skills', professional: 'Professional skills', links: 'Contact and work links', blog: 'My journal', unavailable: 'Image unavailable', page: 'Page' },
} as const;

export function profilePdfSources(input: unknown) {
  const profile = sanitizeProfile(input);
  return { portrait: mediaSource(profile.photo) || PROFILE_PDF_LOGO, cover: mediaSource(profile.cover) || PROFILE_PDF_COVER,
    evidence: [...new Set([...list(profile.skillImages), ...list(profile.workImages)].map(mediaSource).filter(Boolean))] };
}

/** Source-exact fields; structured and legacy string rows share one projection. */
export function profilePdfSections(input: unknown, lang: 'ar' | 'en'): ProfilePdfSection[] {
  const profile = sanitizeProfile(input), labels = copy[lang];
  const entry = (value: unknown) => {
    if (typeof value === 'string') return { heading: value.length <= 300 ? value.trim() : '', organization: '', period: '', description: value.length > 300 ? value.trim() : '' };
    const row = record(value);
    const heading = ['title', 'name', 'label', 'skill', 'language', 'value'].map(key => text(row[key])).find(Boolean) || '';
    const organization = text(row.organization) || text(row.institution);
    const period = [text(row.start) || text(row.date), text(row.end)].filter(Boolean).join(' – ');
    const description = [text(row.description), text(row.level), text(row.proficiency)].filter((value, index, values) => value && values.indexOf(value) === index && value !== heading).join('\n');
    const score = typeof row.level === 'number' ? row.level : typeof row.value === 'number' ? row.value : undefined;
    return { heading: heading || (!description && !organization && !period ? itemText(value) : ''), organization, period,
      description: [description, score !== undefined && Number.isFinite(score) ? String(score) : ''].filter(Boolean).join('\n') };
  };
  const keys = ['experience', 'education', 'training', 'skills', 'memberships', 'languages', 'hobbies', 'achievements', 'timeline'] as const;
  const sections: ProfilePdfSection[] = keys.map(key => ({ key, heading: labels[key], entries: list(profile[key]).map(entry).filter(row => Object.values(row).some(Boolean)) }));
  for (const key of ['human', 'scientific', 'professional'] as const) {
    const entries = list(record(profile.skillRadar)[key]).map(entry).filter(row => Object.values(row).some(Boolean));
    if (entries.length) sections.push({ key: `skillRadar.${key}`, heading: labels[key], entries });
  }
  return sections.filter(section => section.entries.length);
}

export function profilePdfLinks(input: unknown) {
  const profile = sanitizeProfile(input);
  const sources = [...list(profile.socials), ...list(profile.buttons), ...(text(profile.youtube) ? [{ url: profile.youtube }] : [])];
  const seen = new Set<string>();
  return sources.map(socialLink).filter((item): item is NonNullable<ReturnType<typeof socialLink>> => Boolean(item)).filter(item => {
    if (seen.has(item.url)) return false; seen.add(item.url); return true;
  });
}

/** Same font and logical content feed the browser preview and the downloadable bytes. */
export function buildLandscapeProfile(input: unknown, context: ProfilePdfContext, assets: ProfilePdfAssets, format: PdfTextFormatter): TDocumentDefinitions {
  const profile = sanitizeProfile(input), labels = copy[context.lang], rtl = context.lang === 'ar';
  const alignment = rtl ? 'right' : 'left', name = text(profile.name) || text(context.name) || 'KSA.MEN';
  const sections = profilePdfSections(profile, context.lang), links = profilePdfLinks(profile);
  const imageLists = (['skillImages', 'workImages'] as const).map(key => ({ key, values: list(profile[key]).filter(value => Boolean(mediaSource(value))) }));
  const bio = text(profile.bio), blog = text(profile.blog);
  const sourceLength = JSON.stringify({ sections, bio, blog, links }).length;
  const rich = sourceLength > 1800 || sections.length > 4 || imageLists.some(group => group.values.length);
  const imageNodes: Record<string, string> = { portrait: assets.portrait.data, cover: assets.cover.data };
  const bodyText = (value: string, size = 10.5, width = FRAME_WIDTH): ContentText => ({ text: format(value, /[\u0600-\u08ff]/.test(value), width, size), fontSize: size, alignment });
  const heading = (value: string): ContentText => ({ ...bodyText(value, 16), color: GREEN, bold: true, headlineLevel: 1, margin: [0, 17, 0, 9] });
  const location = [text(profile.city), text(profile.country)].filter(Boolean).join(rtl ? '، ' : ', ');
  const contacts = profile.allowContact === false ? [] : [...new Set([text(profile.email), text(profile.phone), text(profile.whatsapp)].filter(Boolean))];
  const url = webUrl(context.url);
  const identityWidth = FRAME_WIDTH - (url ? 232 : 124);
  const identity: Content[] = [
    { ...bodyText(name, rich ? 27 : 23, identityWidth), color: INK, bold: true, margin: [0, 0, 0, 7] },
    ...[text(profile.title), text(profile.specialty)].filter(Boolean).map((value): ContentText => ({ ...bodyText(value, 12.5, identityWidth), color: GREEN, margin: [0, 0, 0, 5] })),
    ...(location ? [{ ...bodyText(location, 9, identityWidth), color: MUTED, margin: [0, 2, 0, 0] } as Content] : []),
    ...contacts.map(value => ({ text: value, fontSize: 9, alignment, color: MUTED, margin: [0, 3, 0, 0] } as Content)),
  ];
  const portrait: Column = { width: 108, stack: [{ image: 'portrait', fit: [96, 104], alignment: 'center' }] };
  const qr: Column[] = url ? [{ width: 84, stack: [{ qr: url, fit: 68, foreground: GREEN, background: '#ffffff', eccLevel: 'H' }] }] : [];
  const content: Content[] = [
    { columns: [{ text: 'KSA.MEN', fontSize: 13, bold: true, color: GREEN, alignment: 'left', characterSpacing: 1.8 }, { ...bodyText(labels.profile, 12, 360), width: '*', color: GOLD }], margin: [0, 0, 0, 12] },
    { image: 'cover', fit: [FRAME_WIDTH, rich ? 220 : 130], alignment: 'center', margin: [0, 0, 0, 20] },
    { columns: rtl ? [...qr, { width: '*', stack: identity }, portrait] : [portrait, { width: '*', stack: identity }, ...qr], columnGap: 16, margin: [0, 0, 0, 9] },
  ];
  if (url) content.push({ text: url, link: url, fontSize: 9, color: GREEN, alignment, margin: [0, 3, 0, 0] });
  const body: Content[] = [];
  const paragraph = (label: string, value: string) => {
    // Keep the section label with a short, source-exact opening, then let the rest flow.
    let split = Math.min(value.length, 180);
    if (split < value.length) { const space = value.lastIndexOf(' ', split); if (space > 40) split = space + 1; }
    body.push({ stack: [heading(label), { ...bodyText(value.slice(0, split)), lineHeight: 1.4 }], unbreakable: true, margin: [0, 0, 0, 4] });
    if (split < value.length) body.push({ ...bodyText(value.slice(split)), lineHeight: 1.4, margin: [0, 0, 0, 8] });
  };
  if (bio) paragraph(labels.summary, bio);
  const cardWidth = (FRAME_WIDTH - 28) / 2;
  for (const section of sections) {
    for (let index = 0; index < section.entries.length; index += 2) {
      const pair = section.entries.slice(index, index + 2);
      const cards: Column[] = pair.map((row, column) => {
        const header: Content[] = [];
        if (index === 0) header.push(column === 0 ? { ...heading(section.heading), fontSize: 15 } : { text: ' ', fontSize: 15, margin: [0, 17, 0, 9] });
        if (row.heading) header.push({ ...bodyText(row.heading, 12, cardWidth), color: INK, bold: true, margin: [0, 0, 0, 4] });
        if (row.organization) header.push({ ...bodyText(row.organization, 10.5, cardWidth), color: GREEN, margin: [0, 0, 0, 3] });
        if (row.period) header.push({ text: row.period, color: MUTED, fontSize: 9, alignment, margin: [0, 0, 0, 4] });
        const stack: Content[] = [{ stack: header, unbreakable: true }];
        if (row.description) stack.push({ ...bodyText(row.description, 10.5, cardWidth), lineHeight: 1.35, margin: [0, 0, 0, 4] });
        return { width: '*', stack };
      });
      if (cards.length === 1) cards.push({ width: '*', text: '' });
      body.push({ columns: rtl ? cards.reverse() : cards, columnGap: 28,
        unbreakable: pair.every(row => row.description.length <= 600 && row.heading.length <= 200 && row.organization.length <= 200), margin: [0, 3, 0, 12] });
    }
  }
  for (const group of imageLists) {
    if (!group.values.length) continue;
    for (const [index, value] of group.values.entries()) {
      const source = mediaSource(value), asset = assets.evidence[source], row = record(value);
      const title = text(row.title) || text(row.label) || text(row.name);
      const description = text(row.description) || text(record(profile.imageDescriptions)[source]);
      const block: Content[] = index === 0 ? [heading(labels[group.key])] : [];
      if (title) block.push({ ...bodyText(title, 12), bold: true, color: INK, margin: [0, 8, 0, 6] });
      if (asset) {
        const key = `${group.key}-${index}`; imageNodes[key] = asset.data;
        block.push({ image: key, fit: [FRAME_WIDTH - 24, 225], alignment: 'center', margin: [0, 6, 0, 8] });
      } else block.push({ ...bodyText(labels.unavailable), color: MUTED, margin: [0, 8, 0, 8] });
      if (description.length <= 220 && description) block.push({ ...bodyText(description), lineHeight: 1.35, margin: [0, 0, 0, 9] });
      body.push({ stack: block, unbreakable: true });
      if (description.length > 220) body.push({ ...bodyText(description), lineHeight: 1.35, margin: [0, 0, 0, 9] });
    }
  }
  if (links.length) {
    for (const [index, link] of links.entries()) body.push({ stack: [
      ...(index === 0 ? [heading(labels.links)] : []),
      { ...bodyText(link.label, 11), bold: true, color: INK, margin: [0, 0, 0, 4] },
      { text: link.url, link: link.url, fontSize: 9, color: GREEN, alignment: 'left', margin: [0, 0, 0, 8] },
    ], unbreakable: true });
  }
  if (blog) paragraph(labels.blog, blog);
  if (rich && body.length) (body[0] as ContentText).pageBreak = 'before';
  content.push(...body);
  return {
    pageSize: 'A4', pageOrientation: 'landscape', pageMargins: [40, 34, 40, 42], compress: true,
    info: { title: `${name} — ${labels.profile}`, author: 'KSA.MEN', subject: labels.profile },
    defaultStyle: { font: 'Tajawal', fontSize: 10.5, color: INK, alignment, lineHeight: 1.3 },
    images: imageNodes,
    background: (_page, size) => ({ canvas: [{ type: 'rect', x: 0, y: 0, w: size.width, h: 5, color: GREEN }] }),
    header: page => page === 1 ? { text: '' } : { columns: [{ text: 'KSA.MEN', color: GREEN, bold: true }, { ...bodyText(name, 9, 510), color: MUTED }], margin: [40, 12, 40, 0], fontSize: 9 },
    footer: (page, count) => ({ columns: [
      { text: url || 'KSA.MEN', ...(url ? { link: url } : {}), fontSize: 8, color: MUTED },
      { text: `${page} / ${count}`, fontSize: 8, color: MUTED, alignment: 'right' },
    ], margin: [40, 13, 40, 0] }),
    pageBreakBefore: (node, following) => Boolean(node.headlineLevel && following.length === 0),
    content,
  };
}
