// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard, { parseDraft } from '../client/src/Dashboard';
import { api, APIError, AppContext } from '../client/src/lib';
vi.mock('../client/src/lib', async (original) => ({ ...await original<typeof import('../client/src/lib')>(), api: vi.fn() }));
const t = (ar: string, _en: string) => ar;
const notify = vi.fn();
const user: any = { id:1, name:'مستخدم اختبار', email:'local@editor.invalid', role:'user', status:'active', trial_until:0, entitlement_until:0, balance:100, whatsapp:'' };
let container: HTMLDivElement, root: Root;
let records: Record<string, any>, puts: Array<{ id:string; body:any }>;
let uploadResult: Promise<any> | null;
let saveHandler: ((id:string, body:any) => Promise<any>) | null;
const deferred = () => { let resolve!: (value:any) => void; const promise = new Promise<any>((accept) => { resolve = accept; }); return { resolve, promise }; };
const flush = async () => { await act(async () => { for (let index=0; index<12; index++) await Promise.resolve(); }); };
function inputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);
  input.dispatchEvent(new Event('input',{bubbles:true}));
}
function saveReply(id:string, body:any) { const site = records[id]; site.draft = structuredClone(body.draft); site.draft_version = body.version+1; return {site:structuredClone(site),version:site.draft_version}; }
function nameInput() { return container.querySelector('input[autocomplete="name"]') as HTMLInputElement; }
function clickSave() { const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim()==='حفظ')!; button.click(); }
async function mount() { await act(async () => root.render(<AppContext.Provider value={{user,lang:'ar',t,notify,refresh:async()=>{}}}><Dashboard/></AppContext.Provider>)); await flush(); expect(nameInput()).not.toBeNull(); }
beforeEach(() => {
  vi.useFakeTimers(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  history.replaceState({},'', '/dashboard?tab=editor'); localStorage.clear();
  Object.defineProperty(window,'matchMedia',{configurable:true,value:()=>({matches:true})});
  HTMLElement.prototype.scrollIntoView=vi.fn();
  container=document.createElement('div'); document.body.append(container); root=createRoot(container);
  records={first:{id:'first',name:'local-first',draft:parseDraft({name:'اسم أول',title:'عنوان',skillImages:['/api/media/existing']}),draft_version:0,status:'draft'},second:{id:'second',name:'local-second',draft:parseDraft({name:'اسم ثان',title:'عنوان ثان'}),draft_version:0,status:'draft'}};
  puts=[]; saveHandler=null; uploadResult=null; notify.mockClear();
  vi.mocked(api).mockImplementation(async (path, options={}) => {
    if(path.startsWith('/api/dashboard')) return {sites:Object.values(records).map((site)=>structuredClone(site)),names:[],notifications:[],reviews:[],services:[]} as any;
    if(path==='/api/services') return [] as any;
    if(path==='/api/upload') return await uploadResult as any;
    const match=/^\/api\/sites\/(first|second)(?:\/(draft|media))?$/.exec(path);
    if(match) {
      const [,id,operation]=match;
      if(operation==='media') return {siteId:id,items:[]} as any;
      if(operation==='draft') { const body=JSON.parse(String(options.body)); puts.push({id,body:structuredClone(body)}); return (saveHandler ? await saveHandler(id,body) : saveReply(id,body)) as any; }
      return {site:structuredClone(records[id])} as any;
    }
    return {} as any;
  });
});
afterEach(async () => { await act(async()=>root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('editor save races — DOM and mocked API only', () => {
  it('keeps focus and newer text when an old autosave response arrives, then saves the next version',async()=>{
    const pending=deferred(); let first=true;
    saveHandler=async(id,body)=>{ if(first){first=false;await pending.promise;} return saveReply(id,body); };
    await mount(); const input=nameInput(); input.focus();
    await act(async()=>inputValue(input,'حرف أول'));
    await act(async()=>vi.advanceTimersByTimeAsync(3000)); expect(puts).toHaveLength(1);
    await act(async()=>inputValue(input,'نص أحدث أثناء الحفظ'));
    await act(async()=>pending.resolve(null)); await flush();
    expect(nameInput()).toBe(input); expect(document.activeElement).toBe(input); expect(input.value).toBe('نص أحدث أثناء الحفظ');
    await act(async()=>vi.advanceTimersByTimeAsync(3000)); await flush();
    expect(puts).toHaveLength(2); expect(puts[1].body.version).toBe(1); expect(puts[1].body.draft.name).toBe('نص أحدث أثناء الحفظ');
    expect(records.first.draft.name).toBe('نص أحدث أثناء الحفظ');
  });
  it('retains text on a failed save and retries with the same version without claiming success',async()=>{
    let failed=false;
    saveHandler=async(id,body)=>{if(!failed){failed=true;throw new APIError('Network unavailable',503);} return saveReply(id,body);};
    await mount(); const input=nameInput();input.focus();
    await act(async()=>inputValue(input,'نص لا يضيع'));
    await act(async()=>vi.advanceTimersByTimeAsync(3000)); await flush();
    expect(input.value).toBe('نص لا يضيع'); expect(nameInput()).toBe(input);expect(document.activeElement).toBe(input);
    expect(container.textContent).toContain('لم يكتمل الحفظ'); expect(records.first.draft.name).toBe('اسم أول');
    await act(async()=>clickSave()); await flush();
    expect(puts[1].body.version).toBe(0);expect(records.first.draft.name).toBe('نص لا يضيع');
    expect(container.textContent).not.toContain('لم يكتمل الحفظ');
  });
  it('drains edits made during a pending save before switching sites',async()=>{
    const pending=deferred();let first=true;
    saveHandler=async(id,body)=>{if(first){first=false;await pending.promise;}return saveReply(id,body);};
    await mount(); const input=nameInput();
    await act(async()=>inputValue(input,'قبل التبديل'));
    const select=container.querySelector('select[aria-label="الموقع الحالي"]') as HTMLSelectElement;
    await act(async()=>{select.value='second';select.dispatchEvent(new Event('change',{bubbles:true}));});
    expect(select.disabled).toBe(true); expect(nameInput()).toBe(input);expect(puts[0].id).toBe('first');
    await act(async()=>inputValue(input,'آخر حرف أثناء انتظار التبديل'));
    await act(async()=>pending.resolve(null));await flush();
    expect(puts).toHaveLength(2);expect(puts[1].id).toBe('first');expect(puts[1].body.version).toBe(1);
    expect(records.first.draft.name).toBe('آخر حرف أثناء انتظار التبديل');expect(nameInput().value).toBe('اسم ثان');
    expect(records.second.draft.name).toBe('اسم ثان');
  });
  it('attaches a delayed upload to the latest list and text, blocks a site switch, and confirms success only after save',async()=>{
    const imageReady=deferred(), saveReady=deferred(); uploadResult=imageReady.promise;
    saveHandler=async(id,body)=>{await saveReady.promise;return saveReply(id,body);};
    class LocalImage { naturalWidth=640; naturalHeight=480; onload: (()=>void)|null=null; onerror:any; set src(_value:string) { queueMicrotask(()=>this.onload?.()); } }
    vi.stubGlobal('Image',LocalImage);
    Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=> 'blob:local-test')});
    Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
    vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(()=>({drawImage:()=>{}}) as any);
    vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation((callback)=>callback(new Blob([new Uint8Array(16)],{type:'image/webp'})));
    await mount();
    const nav = () => [...container.querySelectorAll('.dashboard-editor-substeps button')];
    await act(async()=> (nav().find(button=>button.textContent?.includes('إثبات المهارات')) as HTMLButtonElement).click());
    const fileInput=container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();
    const selectFile = vi.spyOn(fileInput, 'click').mockImplementation(() => {});
    await act(async () => (container.querySelector('button[aria-label="إضافة صورة"]') as HTMLButtonElement).click());
    expect(selectFile).toHaveBeenCalledOnce();
    Object.defineProperty(fileInput,'files',{configurable:true,value:[new File([new Uint8Array(16)],'unit.jpg',{type:'image/jpeg'})]});
    await act(async()=> fileInput.dispatchEvent(new Event('change',{bubbles:true})));await flush();
    expect(vi.mocked(api).mock.calls.some(([path])=>path==='/api/upload')).toBe(true);
    const select=container.querySelector('select[aria-label="الموقع الحالي"]') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    await act(async()=> (container.querySelector('button[aria-label^="إزالة الصورة"]') as HTMLButtonElement).click());
    await act(async()=> (nav()[0] as HTMLButtonElement).click());
    await act(async()=> inputValue(nameInput(),'نص أثناء الرفع'));
    await act(async()=> imageReady.resolve({id:'new-image',url:'/api/media/new-image'}));await flush();
    expect(puts).toHaveLength(1);
    expect(puts[0].body.draft.name).toBe('نص أثناء الرفع');expect(puts[0].body.draft.skillImages).toEqual(['/api/media/new-image']);
    expect(notify).not.toHaveBeenCalledWith('تمت إضافة الصورة وحفظها.');
    await act(async()=> saveReady.resolve(null));await flush();
    expect(notify).toHaveBeenCalledWith('تمت إضافة الصورة وحفظها.');
    expect(records.first.draft.skillImages).toEqual(['/api/media/new-image']);expect(records.second.draft.name).toBe('اسم ثان');
  });

});
