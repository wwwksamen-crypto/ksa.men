// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { updateClientMetadata, updateProfileMetadata, clearProfileMetadata } from '../client/src/page-metadata';
import LoadingState from '../client/src/LoadingState';
import { readFileSync } from 'node:fs';
afterEach(()=>{document.head.innerHTML='';});
describe('Metadata and quiet loading — local DOM',()=>{
 it('keeps one canonical/head set and managed copy on locale changes',()=>{
  updateClientMetadata('/','ar',{title_ar:'عنوان مخصص',body_ar:'محتوى صادق',title_en:'Managed title',body_en:'Managed body'});expect(document.title).toBe('عنوان مخصص — KSA.MEN');
  updateClientMetadata('/','ar');expect(document.title).toBe('عنوان مخصص — KSA.MEN');
  updateClientMetadata('/','en',{title_en:'Managed title',body_en:'Managed body'});expect(document.querySelectorAll('link[rel=canonical]')).toHaveLength(1);expect(document.querySelector('link[rel=canonical]')?.getAttribute('href')).toBe('https://ksa.men/?lang=en');expect(document.title).toContain('Managed title');
 });
 it('uses the original sharing logo after locale changes, not the cover, and preserves profile image version',()=>{
  updateClientMetadata('/','en',{title_en:'Home',body_en:'Home body'});
  expect(document.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe('https://ksa.men/assets/share-logo-1200-v1.png');
  document.querySelector('meta[property="og:image"]')?.setAttribute('content','https://ksa.men/api/public/og/member?lang=ar&v=4-bf124aaa');
  updateProfileMetadata({name:'Public member'},'member','ar',true);
  expect(document.querySelector('meta[property="og:image"]')?.getAttribute('content')).toContain('v=4-bf124aaa');
  updateProfileMetadata({name:'Public member'},'member','en',true);
  const image=document.querySelector('meta[property="og:image"]')?.getAttribute('content')||'';
  expect(image).toContain('lang=en');expect(image).toContain('v=4-bf124aaa');
  updateClientMetadata('/q/abcdefghijklmnop','ar');
  expect(document.title).toBe('بطاقة تعارف — KSA.MEN');expect(document.head.innerHTML).toContain('noindex');
  expect(document.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe('https://ksa.men/assets/share-logo-1200-v1.png');
  expect(document.querySelector('script[type="application/ld+json"]')).toBeNull();
 });
 it('keeps private/error/locked identities out of canonical content and structured data',()=>{
  updateClientMetadata('/dashboard','ar');expect(document.head.innerHTML).toContain('noindex');expect(document.querySelector('script[type="application/ld+json"]')).toBeNull();
  updateProfileMetadata({name:'Public member',bio:'Safe bio'},'member','en',false);expect(document.head.innerHTML).toContain('noindex');expect(document.querySelector('script[type="application/ld+json"]')).toBeNull();
  clearProfileMetadata('ar');expect(document.head.innerHTML).not.toContain('Safe bio');expect(document.querySelector('link[rel=canonical]')).toBeNull();
 });
 it('uses a labelled stable-size logo and reduced-motion rule, without an edit-blocking overlay',()=>{
  const html=renderToStaticMarkup(<LoadingState compact/>);expect(html).toContain('role="status"');expect(html).toContain('width="64"');expect(html).not.toContain('dialog');expect(readFileSync('client/src/loading.css','utf8')).toContain('prefers-reduced-motion:reduce');
 });
 it('does not import the PDF/export renderer into public identity loading or eagerly fetch member services',()=>{
  const personal=readFileSync('client/src/Personal.tsx','utf8');expect(personal).not.toContain("import('./Exports')");expect(personal).toContain("from './vcard'");expect(personal).toContain('IntersectionObserver');
  const dashboard=readFileSync('client/src/Dashboard.tsx','utf8');expect(dashboard).not.toContain('void loadDashboard(); void loadServices();');expect(dashboard).toContain('&view=${activeTab}');
 });
});
