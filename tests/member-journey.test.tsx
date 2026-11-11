// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import Dashboard, { parseDraft } from '../client/src/Dashboard';
import { api, APIError, AppContext } from '../client/src/lib';
import { editRequested, memberSection, memberWorkspace } from '../client/src/member-journey';
vi.mock('../client/src/lib', async original => ({...await original<typeof import('../client/src/lib')>(), api:vi.fn()}));
const user:any={id:1,name:'الاسم المحفوظ',email:'local@journey.invalid',role:'user',status:'active',balance:0,trial_until:0,entitlement_until:0};
const translate=(ar:string,_en:string)=>ar;
let container:HTMLDivElement,root:Root,site:any,failSave:boolean,failSubmit:boolean;
const flush=async()=>{await act(async()=>{for(let i=0;i<15;i++)await Promise.resolve();});};
const click=async(label:string,selector='button')=>{const b=[...container.querySelectorAll<HTMLButtonElement>(selector)].find(b=>b.textContent?.trim()===label);expect(b, label).toBeDefined();await act(async()=>b!.click());await flush();};
const input=(e:HTMLInputElement,value:string)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));};
async function mount(){await act(async()=>root.render(<AppContext.Provider value={{user,lang:'ar',t:translate,notify:vi.fn(),refresh:async()=>{}}}><Dashboard/></AppContext.Provider>));await flush();}
beforeEach(()=>{
  vi.useFakeTimers();(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();history.replaceState({},'', '/dashboard');
  Object.defineProperty(window,'matchMedia',{configurable:true,value:()=>({matches:true})});HTMLElement.prototype.scrollIntoView=vi.fn();
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(){this.setAttribute('open','');}});
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(){this.removeAttribute('open');}});
  container=document.createElement('div');document.body.append(container);root=createRoot(container);failSave=false;failSubmit=false;
  site={id:'local-site',userId:1,name:'local-site',status:'draft',draft_version:0,published_version:0,draft:parseDraft({name:'الاسم المحفوظ',title:'',skillImages:['/api/media/local-evidence'],workImages:['/api/media/local-work'],hidden:['email'],notes:'ملاحظات لا تحذف'})};
  vi.mocked(api).mockReset().mockImplementation(async(path,options={})=>{
    if(path.startsWith('/api/dashboard'))return {sites:site?[structuredClone(site)]:[],names:[],notifications:[],reviews:[],services:[],payments:[],ledger:[],subscriptionRequests:[]} as any;
    if(path==='/api/services')return [] as any;
    if(path.startsWith('/api/names/check'))return {name:'local-new',valid:true,available:true,suggestions:[]} as any;
    if(path==='/api/names/reserve'){const body=JSON.parse(String(options.body));site={id:'local-site',userId:1,name:body.name,status:'draft',draft_version:0,published_version:0,draft:parseDraft({name:user.name})};return {name:body.name,site:structuredClone(site)} as any;}
    if(path==='/api/sites/local-site')return {site:structuredClone(site)} as any;
    if(path.endsWith('/media'))return {siteId:'local-site',items:[]} as any;
    if(path.endsWith('/draft')){if(failSave)throw new APIError('لم يكتمل الحفظ',503);const body=JSON.parse(String(options.body));site.draft=structuredClone(body.draft);site.draft_version=body.version+1;return {site:structuredClone(site),version:site.draft_version} as any;}
    if(path.endsWith('/submit')){if(failSubmit)throw new APIError('لم يكتمل إرسال الطلب',503);site.status='pending';return {message:'موقعك تحت المراجعة، وسيصلك إشعار عند الاعتماد.'} as any;}
    return {} as any;
  });
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.restoreAllMocks();});

describe('member creation and existing editor — local DOM/mock API only',()=>{
  it('maps all existing routes to exactly three primary destinations without dropping sections',()=>{
    expect(['editor','services','wallet','messages','subscription','settings'].map(tab=>memberSection(tab as any))).toEqual(['site','outputs','account','account','account','account']);
    expect(memberWorkspace({status:'draft',published_version:0})).toBe('create');expect(memberWorkspace({status:'pending'})).toBe('overview');expect(memberWorkspace({status:'published',published_version:2})).toBe('overview');
    expect(memberWorkspace({status:'draft'},true)).toBe('edit');expect(editRequested('?tab=editor&mode=edit')).toBe(true);expect(editRequested('?site=delegated')).toBe(true);expect(editRequested('?tab=wallet')).toBe(false);
  });
  it('reserves a real address through the existing endpoint and moves to the short introduction',async()=>{
    site=null;await mount();expect(container.querySelectorAll('.member-creation-steps li')).toHaveLength(3);
    const field=container.querySelector('input[aria-describedby="initial-name-advisory"]') as HTMLInputElement;expect(field).not.toBeNull();
    await act(async()=>input(field,'local-new'));await act(async()=>vi.advanceTimersByTimeAsync(750));await flush();
    expect(container.querySelector('.member-name-preview')?.textContent).toBe('https://local-new.ksa.men');await click('احجز عنوان موقعي');
    const call=vi.mocked(api).mock.calls.find(([p])=>p==='/api/names/reserve');expect(JSON.parse(String(call![1]?.body))).toEqual({name:'local-new'});
    expect(container.querySelector('.member-basics')).not.toBeNull();expect(container.querySelector('.member-creation-steps [aria-current="step"]')?.textContent).toContain('عرّف بنفسك');
  });
  it('shows three primary destinations and optional basics without losing old media or private fields',async()=>{
    await mount();expect([...container.querySelectorAll('.dashboard-tabs button')].map(b=>b.textContent)).toEqual(['موقعي','مخرجاتي','حسابي']);
    expect(container.querySelector('.member-basics')).not.toBeNull();expect(container.querySelector('input[required]')).toBeNull();expect(container.querySelector('details.member-optional-media')?.hasAttribute('open')).toBe(false);
    await click('عاين موقعي');expect(container.querySelector('.dashboard-preview-modal')).not.toBeNull();expect(container.querySelector('.member-site-overview .member-creation-steps')).not.toBeNull();
    expect(site.draft.skillImages).toEqual(['/api/media/local-evidence']);expect(site.draft.workImages).toEqual(['/api/media/local-work']);expect(site.draft.notes).toBe('ملاحظات لا تحذف');expect(site.draft.hidden).toEqual(['email']);
  });
  it('keeps the exact focused basic input through typing and autosave metadata',async()=>{
    await mount();const field=container.querySelector('input[autocomplete="name"]') as HTMLInputElement;field.focus();
    await act(async()=>input(field,'اسم محرر'));await act(async()=>vi.advanceTimersByTimeAsync(3100));await flush();
    expect(container.querySelector('input[autocomplete="name"]')).toBe(field);expect(document.activeElement).toBe(field);expect(field.value).toBe('اسم محرر');
    expect(site.draft.skillImages).toEqual(['/api/media/local-evidence']);
  });
  it('saves the latest change before preview and submit; empty optional title is not a new gate',async()=>{
    await mount();const field=container.querySelector('input[autocomplete="name"]') as HTMLInputElement;await act(async()=>input(field,'آخر تعريف'));
    await click('عاين موقعي');await click('طلب نشر موقعي','.dashboard-preview-modal footer button');
    const calls=vi.mocked(api).mock.calls;expect(calls.findIndex(([p])=>p.endsWith('/draft'))).toBeLessThan(calls.findIndex(([p])=>p.endsWith('/submit')));
    expect(site.draft).toMatchObject({name:'آخر تعريف',title:''});expect(site.status).toBe('pending');expect(container.querySelector('.dashboard-preview-modal')).toBeNull();expect(container.textContent).toContain('موقعك تحت المراجعة');
  });
  it('returns from review to the same basic values when keep editing is chosen',async()=>{
    await mount();await click('عاين موقعي');await click('متابعة التحرير','.dashboard-preview-modal footer button');expect(container.querySelector('.member-basics')).not.toBeNull();expect((container.querySelector('input[autocomplete="name"]') as HTMLInputElement).value).toBe('الاسم المحفوظ');
  });
  it('does not open preview or submit after a failed save and keeps the typed work',async()=>{
    await mount();const field=container.querySelector('input[autocomplete="name"]') as HTMLInputElement;await act(async()=>input(field,'لن يضيع'));failSave=true;await click('عاين موقعي');
    expect(container.querySelector('.dashboard-preview-modal')).toBeNull();expect(field.value).toBe('لن يضيع');expect(vi.mocked(api).mock.calls.some(([p])=>p.endsWith('/submit'))).toBe(false);expect(container.textContent).toContain('لم يكتمل الحفظ');
  });
  it('keeps review visible and never claims pending or published when the submit endpoint fails',async()=>{
    await mount();await click('عاين موقعي');failSubmit=true;await click('طلب نشر موقعي','.dashboard-preview-modal footer button');expect(site.status).toBe('draft');expect(container.querySelector('.dashboard-preview-modal')).not.toBeNull();expect(container.textContent).not.toContain('موقعك تحت المراجعة');
  });
  it('gives an existing published member one overview with edit/preview/request publication',async()=>{
    site.status='published';site.published_version=2;await mount();expect(container.querySelector('.member-site-overview')).not.toBeNull();expect(container.querySelector('.dashboard-edit-card')).toBeNull();
    expect([...container.querySelectorAll('button')].filter(b=>b.textContent?.trim()==='طلب نشر موقعي')).toHaveLength(1);
    await click('تعديل');expect(container.querySelector('.dashboard-edit-card')).not.toBeNull();expect(container.querySelectorAll('.dashboard-editor-navigation > details')).toHaveLength(5);expect(container.querySelectorAll('.dashboard-editor-navigation > details[open]')).toHaveLength(1);
    expect(container.querySelectorAll('.dashboard-review-rail')).toHaveLength(0);
  });
  it.each(['wallet','messages','subscription','settings'])('preserves the %s link inside account and leaves the active site intact',async(tab)=>{
    history.replaceState({},'', '/dashboard?tab='+tab);await mount();expect(container.querySelector('.dashboard-tabs [aria-current="page"]')?.textContent).toBe('حسابي');expect(container.querySelectorAll('.member-account-tabs button')).toHaveLength(4);expect(site.draft.skillImages).toEqual(['/api/media/local-evidence']);
  });
  it('puts real output links before secondary service tools and keeps their exact authorized routes',async()=>{
    history.replaceState({},'', '/dashboard?tab=services');await mount();expect(container.querySelector('.dashboard-services')?.firstElementChild?.classList).toContain('dashboard-exports');
    const links=[...container.querySelectorAll<HTMLAnchorElement>('.dashboard-export-grid a')];expect(links).toHaveLength(6);expect(links[0].getAttribute('href')).toBe('/export/profile?site=local-site&lang=ar');expect(links[1].getAttribute('href')).toBe('/export/ats?site=local-site&lang=ar');
  });
});
