import { describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import { buildResumeContent, newestResumeItems, resumeDate, resumePlainText } from '../client/src/ats-content';
import { createResumePdf } from '../client/src/ats-pdf';
import { createResumeDocx } from '../client/src/ats-docx';
const fonts = { regular: readFileSync('public/assets/Tajawal-Regular.ttf').toString('base64'), bold: readFileSync('public/assets/Tajawal-Bold.ttf').toString('base64') };
const context = { name:'fixture',url:'https://fixture.ksa.men',lang:'ar' as const };
// Readers insert formatting spaces around directional spans and may place punctuation differently.
// Compare the original lexical Unicode sequence, retaining all letters, diacritics and numbers.
const normalize = (value:string) => value.normalize('NFKC').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'').replace(/[\p{P}\p{S}]/gu,' ').replace(/([\p{Script=Latin}\p{N}])([\p{Script=Arabic}])/gu,'$1 $2').replace(/([\p{Script=Arabic}])([\p{Script=Latin}\p{N}])/gu,'$1 $2').replace(/\s+/g,' ').trim();
const fixture = { name:'إسماعيل التميمي',title:'المدير التنفيذي',specialty:'التسويق',bio:'رجل أفرد الله بالعبادة والمخافة. يطور المطور و يحسن المحسن.\nمهندس برمجيات React 19 و Cloudflare Workers.\nبسم الله الرحمن الرحيم. جامعة، جودة، خبرة، إدارة، إنجاز، مسؤولية.',email:'candidate@example.com',phone:'+966555000000',experience:[{title:'خبرة سابقة',organization:'جهة سابقة',start:'2012',end:'2019'},{title:'خبرة أحدث',organization:'جهة أحدث',start:'2020',end:'حتى الآن'}],skills:['إدارة المشروعات',{name:'الجودة',level:'متقدم'}],languages:[{language:'العربية',proficiency:'لغة أم'},{language:'English',proficiency:'Professional'}],blog:'BLOG PRIVATE',hobbies:['HOBBY PRIVATE'],notes:'NOTES PRIVATE',workImages:['/api/media/fixture'] };
async function extract(bytes:Uint8Array){const doc=await getDocument({data:bytes.slice(),useSystemFonts:false}).promise;let output='';for(let index=1;index<=doc.numPages;index++){const page=await doc.getPage(index);output+=(await page.getTextContent()).items.map(value=>'str' in value?value.str:'').join(' ')+'\n';}const pages=doc.numPages;await doc.destroy();return {text:normalize(output),raw:output,pages};}
describe('ATS logical Arabic/English content and actual document',()=>{
 it('sorts explicit valid dates newest-first without mutating, inventing dates, or reordering unknown dates',()=>{
  expect(resumeDate('٢٠٢٤-٠٢-٢٩')).toBe(20240229);expect(resumeDate('2023-02-29')).toBeNull();expect(resumeDate('Present')).toBeNull();expect(resumeDate('2024-13')).toBeNull();
  const source=[{title:'unknown1'},{title:'older',start:'2012'},{title:'unknown2'},{title:'latest',start:'2020'}];const before=JSON.stringify(source);expect(newestResumeItems(source).map(row=> (row as {title:string}).title)).toEqual(['latest','older','unknown1','unknown2']);expect(JSON.stringify(source)).toBe(before);
 });
 it('uses the same logical text for alternatives; includes structured skills and languages, excludes private/non-career content and hidden items',()=>{
  const profile={...fixture,hidden:['email'],itemIds:{skills:['one','two']},hiddenItems:['skills:one']};const before=JSON.stringify(profile);const source=buildResumeContent(profile,context);const text=resumePlainText(source);
  expect(text).toContain('الجودة');expect(text).toContain('متقدم');expect(text).toContain('العربية');expect(text).toContain('لغة أم');expect(text).toContain('English');
  for(const privateValue of ['candidate@example.com','إدارة المشروعات','BLOG PRIVATE','HOBBY PRIVATE','NOTES PRIVATE','/api/media/fixture'])expect(text).not.toContain(privateValue);
  expect(JSON.stringify(profile)).toBe(before);expect(text.indexOf('خبرة أحدث')).toBeLessThan(text.indexOf('خبرة سابقة'));expect(text).toContain(fixture.bio);
 });
 it('embeds text fonts with no images/QR and preserves key Arabic words and mixed Latin prose in PDF.js and Poppler',async()=>{
  const source=buildResumeContent(fixture,context);const bytes=await createResumePdf(source,fonts);const parsed=await extract(bytes);
  const temp=mkdtempSync(join(tmpdir(),'ksa-ats-'));let poppler='';try{writeFileSync(join(temp,'resume.pdf'),bytes);poppler=normalize(execFileSync('pdftotext',[join(temp,'resume.pdf'),'-'],{encoding:'utf8'}));}finally{rmSync(temp,{recursive:true,force:true});}
  const essential=[fixture.name,fixture.title,fixture.specialty,fixture.bio,fixture.email,fixture.phone,'جهة أحدث','جهة سابقة','حتى الآن','جامعة','الله','الجودة','مسؤولية'];
  for(const value of essential){expect(parsed.text).toContain(normalize(value));expect(poppler).toContain(normalize(value));}
  expect(parsed.raw).toContain(fixture.email);expect(parsed.raw).toContain(fixture.phone);expect(parsed.text).not.toContain('هللا');expect(parsed.text.indexOf('خبرة أحدث')).toBeLessThan(parsed.text.indexOf('خبرة سابقة'));expect(parsed.pages).toBeGreaterThan(0);
  const pdf=await PDFDocument.load(bytes);for(const page of pdf.getPages()){expect(page.getWidth()).toBeLessThan(page.getHeight());const objects=page.node.Resources()?.lookup(PDFName.of('XObject')) as PDFDict|undefined;expect(objects?.keys().length || 0).toBe(0);}
  const fontDicts=pdf.context.enumerateIndirectObjects().map(([,value])=>value).filter(value=>value instanceof PDFDict&&value.get(PDFName.of('Type'))?.toString()==='/FontDescriptor') as PDFDict[];
  expect(fontDicts.length).toBeGreaterThan(0);for(const font of fontDicts)expect(font.has(PDFName.of('FontFile2'))).toBe(true);
 });
 it('preserves saved English and Arabic names in English mode without fabricated translation',async()=>{
  const source=buildResumeContent({name:'Approved English Name',title:'Software Engineer',bio:'Original saved English summary with React 19 and Cloudflare Workers.',experience:[{title:'Engineering Lead',organization:'Saved Company',start:'2024',end:'Present'}],languages:[{language:'العربية',level:'Native'}]},{...context,lang:'en'});const {text}=await extract(await createResumePdf(source,fonts));expect(text).toContain('Approved English Name');expect(text).toContain('Software Engineer');expect(text).toContain(normalize('Original saved English summary with React 19 and Cloudflare Workers.'));expect(text).toContain('العربية');expect(text).toContain('Native');expect(text).toContain('Professional Experience');
 });
 it('produces a minimal one-page resume and flows lengthy paragraphs across pages without dropping the final content',async()=>{
  expect((await extract(await createResumePdf(buildResumeContent({name:'اسم قليل البيانات'},context),fonts))).pages).toBe(1);
  const bio=Array.from({length:120},(_,i)=>`بسم الله الرحمن الرحيم. مسؤولية ومهارة وجودة وإدارة المشروعات رقم ${i+1}.`).join('\n');const parsed=await extract(await createResumePdf(buildResumeContent({name:'ملف طويل',bio:bio+'\nعلامة النهاية المحفوظة'},context),fonts));expect(parsed.pages).toBeGreaterThan(1);expect(parsed.text).toContain('علامة النهاية المحفوظة');expect(parsed.text).toContain('الله');
 });
 it('provides DOCX logical Unicode paragraphs without tables, drawings, macros or private material',async()=>{
  const source=buildResumeContent({...fixture,hidden:['email']},context);const bytes=await createResumeDocx(source);const temp=mkdtempSync(join(tmpdir(),'ksa-docx-'));try{const file=join(temp,'resume.docx');writeFileSync(file,bytes);const xml=execFileSync('unzip',['-p',file,'word/document.xml'],{encoding:'utf8'});expect(xml).toContain(fixture.name);expect(xml).toContain('الله');expect(xml).toContain('w:bidi');expect(xml).not.toContain('<w:tbl>');expect(xml).not.toContain('<w:drawing>');expect(xml).not.toContain(fixture.email);expect(xml).not.toContain('NOTES PRIVATE');expect(xml).not.toContain('BLOG PRIVATE');expect(xml.indexOf('خبرة أحدث')).toBeLessThan(xml.indexOf('خبرة سابقة'));}finally{rmSync(temp,{recursive:true,force:true});}
 });
});
