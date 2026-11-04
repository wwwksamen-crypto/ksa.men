import { displayCountry } from '../shared/display-country';
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { managedText, managedBlocks } from '../shared/managed-text';
import { api, APIError, displayError } from '../client/src/lib';
import { updateClientMetadata } from '../client/src/page-metadata';
import { readFileSync } from 'node:fs';
afterEach(()=>{vi.unstubAllGlobals();document.head.innerHTML='';localStorage.clear();});
describe('Public managed copy and localized errors',()=>{
 it('localizes canonical country labels without altering free text or stored data',()=>{const country='Saudi Arabia';expect(displayCountry(country,'ar')).toBe('المملكة العربية السعودية');expect(country).toBe('Saudi Arabia');expect(displayCountry('London HQ','ar')).toBe('London HQ');expect(displayCountry(null,'ar')).toBe('');});
 it('normalizes only literal line separators without modifying its source or interpreting HTML',()=>{
  const original='عنوان\\n\\nنص طويل\\r\\nسطر <script>alert(1)</script>';
  expect(managedText(original)).toBe('عنوان\n\nنص طويل\nسطر <script>alert(1)</script>');
  expect(original).toContain('\\n');expect(managedText(null)).toBe('');
  expect(managedBlocks('## حقوقك\\n\\nالنص')).toEqual([{kind:'heading',text:'حقوقك'},{kind:'paragraph',text:'النص'}]);
 });
 it('removes literal newline encodings from metadata in either locale',()=>{
  updateClientMetadata('/privacy','ar',{title_ar:'الخصوصية',body_ar:'نص\\n\\nحق'});
  expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).not.toContain('\\n');
 });
 it('keeps library exceptions out of Arabic product copy and retains actionable Arabic messages',()=>{
  document.documentElement.lang='ar';expect(displayError(new Error('Canvas render failed'),'تعذر تجهيز الملف.')).toBe('تعذر تجهيز الملف.');
  expect(displayError(new Error('تغيّرت بيانات الملف.'),'تعذر التجهيز.')).toBe('تغيّرت بيانات الملف.');
  document.documentElement.lang='en';expect(displayError(new Error('The profile changed.'),'Retry')).toBe('The profile changed.');
 });
 it('localizes a raw server failure without changing its status or requiring a new session',async()=>{
  document.documentElement.lang='ar';vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:'Internal error',code:'FAILURE'}),{status:500})));
  await expect(api('/api/public/demo')).rejects.toMatchObject({status:500,code:'FAILURE'});
  try{await api('/api/public/demo');}catch(cause){expect(cause).toBeInstanceOf(APIError);expect((cause as Error).message).toMatch(/تعذر/);expect((cause as Error).message).not.toContain('Internal');}
 });
 it('uses shared safe public rendering without reintroducing innerHTML and localizes visible export choices',()=>{
  const client=readFileSync('client/src/main.tsx','utf8'),server=readFileSync('server/seo.ts','utf8'),exports=readFileSync('client/src/Exports.tsx','utf8');
  expect(client).toContain('managedBlocks(body)');expect(server).toContain('managedBlocks(body)');
  expect(exports).not.toContain('>vCard</KindButton>');expect(exports).not.toContain('>QR</KindButton>');
  expect(exports).toContain("t('بطاقة الاتصال', 'vCard')");
 });
});
