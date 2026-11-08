// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { homePreviewDescription } from '../shared/home-preview';
import { metadata, profileBody } from '../shared/seo';
import { updateClientMetadata } from '../client/src/page-metadata';
import { DictatedInput, DictatedTextarea } from '../client/src/DictatedField';
import { readFileSync } from 'node:fs';
const tr=(ar:string,_en:string)=>ar;
let root:Root,host:HTMLDivElement;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();document.head.innerHTML='';});
describe('Homepage preview and automatic text direction',()=>{
 it('inserts the exact identity before the existing Arabic copy without changing its value',()=>{
  const body='اسمك عنوانك. وخبرتك قصة تستحق أن تُرى.';
  expect(homePreviewDescription(body,'ar')).toBe('منصة رجال المملكة العربية السعودية\n'+body);
  expect(body).toBe('اسمك عنوانك. وخبرتك قصة تستحق أن تُرى.');
 });
 it('retains managed copy, normalizes legacy line endings for display and never duplicates identity',()=>{
  const first=homePreviewDescription('نص الإدارة\\nالسطر الثاني','ar');
  expect(first).toContain('نص الإدارة\nالسطر الثاني');expect(homePreviewDescription(first,'ar')).toBe(first);
 });
 it('uses an independent English definition and no Arabic in the English default',()=>{
  const body=homePreviewDescription('Your expertise deserves to be seen.','en');expect(body).toContain('The platform for men of the Kingdom of Saudi Arabia');expect(body).not.toMatch(/[\u0600-\u06ff]/);
 });
 it('keeps image/title and identical description across meta, Open Graph and Twitter',()=>{
  const description=homePreviewDescription('اسمك عنوانك. وخبرتك قصة تستحق أن تُرى.','ar');
  document.head.innerHTML=metadata({title:'KSA.MEN — ظهور رقمي يليق بك',description,lang:'ar',indexable:true,image:'https://ksa.men/assets/share-logo-1200-v1.png'});
  for(const selector of ['meta[name="description"]','meta[property="og:description"]','meta[name="twitter:description"]'])expect(document.querySelector(selector)?.getAttribute('content')).toBe(description);
  expect(document.querySelector('meta[property="og:image"]')?.getAttribute('content')).toContain('share-logo-1200-v1.png');
 });
 it('client updates add the identity only to home and preserve page-specific managed descriptions elsewhere',()=>{
  updateClientMetadata('/','ar',{title_ar:'عنوان الإدارة',body_ar:'نص الإدارة'});expect(document.querySelector('meta[property="og:description"]')?.getAttribute('content')).toBe('منصة رجال المملكة العربية السعودية\nنص الإدارة');
  updateClientMetadata('/about','ar',{title_ar:'من نحن',body_ar:'محتوى مستقل'});expect(document.querySelector('meta[property="og:description"]')?.getAttribute('content')).toBe('محتوى مستقل');
 });
 it('keeps the same focused editor DOM node while mixed text changes and retains explicit technical direction',async()=>{
  const onChange=vi.fn();const props={onChange,lang:'ar' as const,tr,label:'النبذة'};
  await act(async()=>root.render(<DictatedInput {...props} value="خبرة"/>));const input=host.querySelector('input')!;input.focus();
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'خبرة في Microsoft 365');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>root.render(<DictatedInput {...props} value="خبرة في Microsoft 365"/>));
  expect(host.querySelector('input')).toBe(input);expect(document.activeElement).toBe(input);expect(input.getAttribute('dir')).toBe('auto');expect(onChange).toHaveBeenCalledWith('خبرة في Microsoft 365');
  await act(async()=>root.render(<DictatedInput {...props} value="support@example.test" type="email"/>));expect(input.getAttribute('dir')).toBe('ltr');
  await act(async()=>root.render(<DictatedInput {...props} value="نص" dir="rtl"/>));expect(input.getAttribute('dir')).toBe('rtl');
 });
 it('textarea direction is automatic and does not alter spaces, paragraph breaks or user content',async()=>{
  const value='Senior specialist\n\nخبرة   نوعية 2024';await act(async()=>root.render(<DictatedTextarea value={value} onChange={vi.fn()} lang="ar" tr={tr} label="نص حر"/>));
  const textarea=host.querySelector('textarea')!;expect(textarea.getAttribute('dir')).toBe('auto');expect(textarea.value).toBe(value);
 });
 it('initial profile HTML isolates date order and escapes user text without altering data',()=>{
  const profile={name:'Saudi Expert',bio:'نص <script> & خبرة\nفقرة',experience:[{title:'مهندس',start:'2022',end:'2025',description:'خبرة Microsoft 365'}]};const before=JSON.stringify(profile);const body=profileBody(profile,'sample','ar');
  expect(body).toContain('<h1 dir="auto">Saudi Expert</h1>');expect(body).toContain('<p dir="ltr">2022 — 2025</p>');expect(body).toContain('&lt;script&gt; &amp;');expect(JSON.stringify(profile)).toBe(before);
 });
 it('composition wraps normally, keeps wide-prose justification scoped and does not clip or globally force centering',()=>{
  const css=readFileSync('client/src/text-layout.css','utf8');expect(css).toContain('@container ksa-prose (min-width: 40rem)');expect(css).toContain('text-align-last: start');expect(css).toContain('overflow-wrap: anywhere');expect(css).not.toMatch(/word-break:\s*break-all|overflow:\s*hidden|text-overflow:\s*ellipsis|text-align:\s*center/);
 });
});
