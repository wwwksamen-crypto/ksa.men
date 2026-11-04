// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Exports from '../client/src/Exports';
import { api, AppContext } from '../client/src/lib';
import { loadProfilePdfAssets } from '../client/src/profile-pdf-assets';
const mocks = vi.hoisted(() => ({ createPdf: vi.fn(), getBuffer: vi.fn(), download: vi.fn() }));
vi.mock('../client/src/lib', async original => ({ ...await original<typeof import('../client/src/lib')>(), api: vi.fn() }));
vi.mock('../client/src/profile-pdf-assets', () => ({ loadProfilePdfAssets: vi.fn() }));
vi.mock('../client/src/ProfilePdfPreview', () => ({ default: ({ bytes }: {bytes:Uint8Array}) => <div data-testid="exact-file-preview" data-bytes={Array.from(bytes).join(',')}/> }));
vi.mock('pdfmake/build/pdfmake.js', () => ({ default: { addVirtualFileSystem:vi.fn(),addFonts:vi.fn(),createPdf:mocks.createPdf } }));
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
 it('keeps ATS a separate existing portrait document rather than reusing the landscape profile',async()=>{
  await click('ATS');expect(mocks.download).toHaveBeenCalledTimes(1);expect(mocks.createPdf.mock.calls[0][0].pageOrientation).toBeUndefined();expect(mocks.getBuffer).not.toHaveBeenCalled();
 });
});
