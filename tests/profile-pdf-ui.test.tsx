// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Exports, { QRTools } from '../client/src/Exports';
import { api, AppContext } from '../client/src/lib';
import { loadProfilePdfAssets } from '../client/src/profile-pdf-assets';
const mocks = vi.hoisted(() => ({ createPdf: vi.fn(), getBuffer: vi.fn(), download: vi.fn(), resumePdf: vi.fn(), resumeFonts: vi.fn(), resumeDocx: vi.fn() }));
vi.mock('../client/src/lib', async original => ({ ...await original<typeof import('../client/src/lib')>(), api: vi.fn() }));
vi.mock('../client/src/profile-pdf-assets', () => ({ loadProfilePdfAssets: vi.fn() }));
vi.mock('../client/src/ProfilePdfPreview', () => ({ default: ({ bytes }: {bytes:Uint8Array}) => <div data-testid="exact-file-preview" data-bytes={Array.from(bytes).join(',')}/> }));
vi.mock('pdfmake/build/pdfmake.js', () => ({ default: { addVirtualFileSystem:vi.fn(),addFonts:vi.fn(),createPdf:mocks.createPdf } }));
vi.mock('../client/src/ats-pdf', () => ({ createResumePdf:mocks.resumePdf, loadResumeFonts:mocks.resumeFonts }));
vi.mock('../client/src/ats-docx', () => ({ createResumeDocx:mocks.resumeDocx }));
vi.mock('qrcode', () => ({default:{toDataURL:vi.fn(async()=> 'data:image/png;base64,QR')}}));
const t = (ar:string,_en:string) => ar, notify=vi.fn();
let container:HTMLDivElement,root:Root,data:any,blobs:Blob[];
const flush=async()=> {await act(async()=> {for(let i=0;i<15;i++)await Promise.resolve();});};
const button=(name:string)=>[...container.querySelectorAll<HTMLButtonElement>('button')].find(value=>value.textContent?.trim()===name)!;
const click=async(name:string)=>{await act(async()=>button(name).click());await flush();};
beforeEach(async()=>{
 vi.clearAllMocks();(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 window.history.replaceState({},'', '/export/profile?public=fixture');
 data={profile:{name:'مصدر ملف',bio:'نبذة محفوظة'},site:'local-id',name:'fixture',allowed:true,translated:true,source:'published'};
 vi.mocked(api).mockImplementation(async()=>data);
 const image={data:'data:image/png;base64,fixture',width:100,height:100};vi.mocked(loadProfilePdfAssets).mockResolvedValue({portrait:image,cover:image,evidence:{},unavailable:[]});
 mocks.resumePdf.mockResolvedValue(new Uint8Array([37,80,68,70,2,3]));mocks.resumeFonts.mockResolvedValue({regular:'font',bold:'font'});mocks.resumeDocx.mockResolvedValue(new Uint8Array([80,75,3,4]));
 mocks.getBuffer.mockImplementation(cb=>cb(new Uint8Array([37,80,68,70,1])));mocks.createPdf.mockReturnValue({getBuffer:mocks.getBuffer,download:mocks.download});
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)})));
 vi.stubGlobal('Image',class{onload:(()=>void)|null=null;onerror:(()=>void)|null=null;naturalWidth=100;naturalHeight=100;set src(_value:string){void Promise.resolve().then(()=>this.onload?.());}});
 const noop=()=>{};vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({measureText:(value:string)=>({width:value.length*7}),drawImage:noop,save:noop,beginPath:noop,arc:noop,fill:noop,clip:noop,restore:noop,stroke:noop} as any);
 vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockReturnValue('data:image/png;base64,QR');
 Object.defineProperty(document,'fonts',{configurable:true,value:{load:async()=>[],ready:Promise.resolve()}});
 blobs=[];URL.createObjectURL=vi.fn(blob=>{blobs.push(blob as Blob);return 'blob:local-profile';});URL.revokeObjectURL=vi.fn();vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
 container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
 await act(async()=>root.render(<AppContext.Provider value={{lang:'ar',t,notify,user:null} as any}><Exports/></AppContext.Provider>));await flush();
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('exact-file landscape preview and download — DOM only',()=>{
 it('keeps one app-owned main landmark for exports',async()=>{await act(async()=>root.render(<AppContext.Provider value={{lang:'ar',t,notify,user:null} as any}><main id="main-content"><Exports/></main></AppContext.Provider>));await flush();expect(container.querySelectorAll('main')).toHaveLength(1);expect(container.querySelector('main main')).toBeNull();});
 it('keeps one app-owned main landmark for free contact tools',async()=>{await act(async()=>root.render(<AppContext.Provider value={{lang:'ar',t,notify,user:null} as any}><main id="main-content"><QRTools/></main></AppContext.Provider>));await flush();expect(container.querySelectorAll('main')).toHaveLength(1);expect(container.querySelector('main main')).toBeNull();expect(container.textContent).toContain('خدمة مجانية');});
 it('prepares once on request, shows the same buffer, and downloads that buffer instead of regenerating another PDF',async()=>{
  expect(mocks.createPdf).not.toHaveBeenCalled();expect(container.querySelector('[data-testid="exact-file-preview"]')).toBeNull();
  await click('معاينة الصفحات');expect(mocks.createPdf).toHaveBeenCalledTimes(1);expect(container.querySelector('[data-testid="exact-file-preview"]')?.getAttribute('data-bytes')).toBe('37,80,68,70,1');
  await click('تنزيل الملف التعريفي');expect(mocks.createPdf).toHaveBeenCalledTimes(1);expect(blobs[0]?.type).toBe('application/pdf');expect(blobs[0]?.size).toBe(5);
  expect(mocks.createPdf.mock.calls[0][0].pageOrientation).toBe('landscape');
 });
 it('invalidates the prepared file after refresh, without leaving the previous private preview in the page',async()=>{
  await click('معاينة الصفحات');data={...data,profile:{name:'نسخة أحدث',bio:'تغيير محفوظ'}};
  await click('تحديث');expect(container.querySelector('[data-testid="exact-file-preview"]')).toBeNull();
  await click('معاينة الصفحات');expect(mocks.createPdf).toHaveBeenCalledTimes(2);expect(JSON.stringify(mocks.createPdf.mock.calls[1][0])).toContain('نسخة أحدث');
 });
 it('refuses to download an obsolete generation when reload completes during image preparation',async()=>{
  let resolve!:(value:any)=>void;vi.mocked(loadProfilePdfAssets).mockImplementationOnce(()=>new Promise(accept=>{resolve=accept;}));
  await act(async()=>button('تنزيل الملف التعريفي').click());await flush();data={...data,profile:{name:'جديد'}};await click('تحديث');
  const image={data:'data:image/png;base64,fixture',width:100,height:100};await act(async()=>resolve({portrait:image,cover:image,evidence:{},unavailable:[]}));await flush();
  expect(blobs).toHaveLength(0);expect(container.querySelector('[data-testid="exact-file-preview"]')).toBeNull();
 });
 it('keeps ATS a separate text engine, not the visual landscape PDF or a QR document',async()=>{
  await click('السيرة');expect(mocks.resumePdf).toHaveBeenCalledTimes(1);expect(mocks.createPdf).not.toHaveBeenCalled();expect(mocks.getBuffer).not.toHaveBeenCalled();expect(blobs[0]?.type).toBe('application/pdf');expect(blobs[0]?.size).toBe(6);
 });
 it('previews and downloads the same ATS bytes without regeneration',async()=>{
  await click('سيرة ذاتية');await click('معاينة السيرة');expect(mocks.resumePdf).toHaveBeenCalledTimes(1);expect(container.querySelector('[data-testid="exact-file-preview"]')?.getAttribute('data-bytes')).toBe('37,80,68,70,2,3');
  await click('تنزيل السيرة الذاتية');expect(mocks.resumePdf).toHaveBeenCalledTimes(1);expect(blobs[0]?.size).toBe(6);
 });
 it('offers Word and a logical text copy using the same ATS content and entitlement',async()=>{
  await click('سيرة ذاتية');await click('تنزيل وورد');expect(mocks.resumeDocx).toHaveBeenCalledTimes(1);expect(blobs[0]?.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  await click('تنزيل نسخة نصية');expect(blobs[1]?.type).toBe('text/plain;charset=utf-8');expect(mocks.resumePdf).not.toHaveBeenCalled();expect(mocks.resumeDocx.mock.calls[0][0].blocks[0].text).toBe('مصدر ملف');
 });
 it('clears ATS preview on refresh and prevents a stale in-flight ATS download',async()=>{
  await click('سيرة ذاتية');let resolve!:(value:Uint8Array)=>void;mocks.resumePdf.mockImplementationOnce(()=>new Promise(accept=>{resolve=accept;}));
  await act(async()=>button('تنزيل السيرة الذاتية').click());await flush();data={...data,profile:{name:'ملف جديد'}};await click('تحديث');await act(async()=>resolve(new Uint8Array([37,80,68,70,2])));await flush();expect(blobs).toHaveLength(0);expect(container.querySelector('[data-testid="exact-file-preview"]')).toBeNull();
 });
 it('does not fabricate an English ATS export without the saved translated version',async()=>{
  await click('سيرة ذاتية');data={...data,translated:false};await act(async()=>{const select=container.querySelector('select')!;select.value='en';select.dispatchEvent(new Event('change',{bubbles:true}));});await flush();
  expect(button('تنزيل السيرة الذاتية')).toBeUndefined();expect(button('تنزيل وورد')).toBeUndefined();expect(mocks.resumePdf).not.toHaveBeenCalled();expect(mocks.resumeDocx).not.toHaveBeenCalled();
 });
});
