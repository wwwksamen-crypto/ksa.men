import { describe, expect, it, vi } from 'vitest';
import { buildLandscapeProfile, profilePdfSources, profilePdfSections, profilePdfLinks, PROFILE_PDF_COVER, PROFILE_PDF_LOGO, type ProfilePdfAssets } from '../client/src/profile-pdf';
import { profileItemIds } from '../shared/profile-visibility';
const image = { data: 'data:image/png;base64,fixture', width: 400, height: 220 };
const assets: ProfilePdfAssets = { portrait: image, cover: image, evidence: { '/api/media/skill-a': image, '/api/media/work-a': image }, unavailable: [] };
const context = { name: 'local-profile', url: 'https://local-profile.ksa.men', lang: 'ar' as const };
const format = (value: string) => value;
const complete = { name: 'اسم محفوظ', title: 'المسمى الأصلي', specialty: 'تخصص أصلي', bio: 'نبذة المصدر محفوظة', city: 'الرياض', country: 'السعودية', email: 'local@fixture.invalid', phone: '0500000000',
  photo: '/api/media/portrait', cover: '/api/media/cover',
  experience: [{ title: 'خبرة', organization: 'جهة', start: '2020-04', end: '2024-06', description: 'وصف الخبرة الأصلي' }], education: ['تعليم أصلي'], training: [{ title: 'دورة', organization: 'جهة الدورة' }], skills: [{ title: 'مهارة', description: 'تفصيل المهارة' }], memberships: [{ title: 'عضوية', organization: 'جهة العضوية' }], languages: [{ title: 'العربية', description: 'متقدم' }], hobbies: ['هواية'], achievements: ['إنجاز'], timeline: [{ title: 'مسار', start: '2021', end: '2022' }],
  skillRadar: { human: ['رادار إنساني'], scientific: ['رادار علمي'], professional: ['رادار مهني'] }, skillImages: ['/api/media/skill-a'], workImages: ['/api/media/work-a'], imageDescriptions: { '/api/media/skill-a': 'وصف شاهد', '/api/media/work-a': 'وصف عمل' },
  socials: [{ url: 'https://x.com/localfixture' }], youtube: 'https://www.youtube.com/@localfixture', buttons: [{ label: 'رابط عمل', url: 'https://example.com/work' }], blog: 'نص المدونة الأصلي', notes: 'PRIVATE NOTES NEVER EXPORT', private: { value: 'PRIVATE FIELD NEVER EXPORT' },
};
describe('source-exact landscape professional profile — local only', () => {
 it('is A4 landscape with embedded-font text, images, usable web links and automatic page numbers', () => {
  const document = buildLandscapeProfile(complete, context, assets, format);
  expect(document.pageSize).toBe('A4'); expect(document.pageOrientation).toBe('landscape'); expect(document.defaultStyle?.font).toBe('Tajawal');
  expect(document.images?.portrait).toBe(image.data); expect(document.images?.cover).toBe(image.data); expect(document.images?.['skillImages-0']).toBe(image.data);
  expect(JSON.stringify(document)).toContain('https://x.com/localfixture'); expect(typeof document.footer).toBe('function');
 });
 it('includes every professional section and structured row without replacing dates, organisations or descriptions', () => {
  const document = JSON.stringify(buildLandscapeProfile(complete, context, assets, format));
  for (const value of ['تخصص أصلي','خبرة','جهة الدورة','2020-04 – 2024-06','تفصيل المهارة','جهة العضوية','متقدم','هواية','إنجاز','رادار إنساني','رادار علمي','رادار مهني','وصف شاهد','وصف عمل','نص المدونة الأصلي']) expect(document).toContain(value);
  expect(document).not.toContain('PRIVATE NOTES'); expect(document).not.toContain('PRIVATE FIELD');
 });
 it('never loads or emits hidden images, captions, rows, identity, contact or nested radar sections', () => {
  const value = { ...complete, itemIds: profileItemIds(complete), hidden: ['name','photo','cover','email','workImages','skillRadar.scientific','blog'], hiddenItems: [`skills:${profileItemIds(complete).skills[0]}`] };
  const sources = profilePdfSources(value); expect(sources.portrait).toBe(PROFILE_PDF_LOGO); expect(sources.cover).toBe(PROFILE_PDF_COVER); expect(sources.evidence).toEqual(['/api/media/skill-a']);
  const document = JSON.stringify(buildLandscapeProfile(value, context, assets, format));
  for (const value of ['اسم محفوظ','local@fixture.invalid','تفصيل المهارة','وصف عمل','نص المدونة الأصلي','رادار علمي']) expect(document).not.toContain(value);
 });
 it('reuses shared approved media rules rather than accepting external, script or credentialed URLs', () => {
  expect(profilePdfSources({ photo:'https://outside.invalid/private.png',cover:'javascript:alert(1)',skillImages:['/api/media/safe',{ url:'/api/media/safe' },'/api/media/../receipt','https://outside.invalid/a'] })).toEqual({portrait:PROFILE_PDF_LOGO,cover:PROFILE_PDF_COVER,evidence:['/api/media/safe']});
  expect(profilePdfLinks({ socials:[{url:'javascript:alert(1)'},{url:'https://user:password@example.com'}],buttons:[{url:'https://example.com'}] })).toHaveLength(1);
 });
 it('uses compact content with no forced blank continuation page for a sparse profile', () => {
  const document = buildLandscapeProfile({name:'Minimal'},context,assets,format);
  expect(JSON.stringify(document.content)).not.toContain('pageBreak'); expect(profilePdfSections({},'en')).toEqual([]);
 });
 it('keeps exact evidence captions even when an image is unavailable, never fabricates qualifications', () => {
  const document = JSON.stringify(buildLandscapeProfile(complete,context,{...assets,evidence:{}},format));
  expect(document).toContain('الصورة غير متاحة'); expect(document).toContain('وصف شاهد'); expect(document).not.toContain('image":"skillImages-0');
 });
 it('prevents a headline-only end of page without moving an ordinary paragraph or creating an empty page', () => {
  const fn = buildLandscapeProfile({},context,assets,format).pageBreakBefore!;
  expect(fn({headlineLevel:1} as any,[],[],[])).toBe(true); expect(fn({headlineLevel:1} as any,[{}] as any,[],[])).toBe(false); expect(fn({text:'paragraph'} as any,[],[],[])).toBe(false);
 });
 it('uses independent English labels only when the caller supplied the verified English source', () => {
  const document = JSON.stringify(buildLandscapeProfile({name:'Exact saved name',experience:['Exact saved experience']},{...context,lang:'en'},assets,format));
  expect(document).toContain('Experience'); expect(document).toContain('Exact saved experience'); expect(document).not.toContain('الخبرات');
  const formatter = vi.fn((value:string) => value); buildLandscapeProfile({name:'اسم عربي محفوظ'},{...context,lang:'en'},assets,formatter);
  expect(formatter).toHaveBeenCalledWith('اسم عربي محفوظ',true,expect.any(Number),expect.any(Number));
  buildLandscapeProfile({experience:[{title:'خبرة',start:'2020',end:'حتى الآن'}]},context,assets,formatter);
  expect(formatter).toHaveBeenCalledWith('2020 – حتى الآن',true,expect.any(Number),9);
 });
});
