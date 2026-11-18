// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {AppContext} from '../client/src/lib';
import PrivacyPanel from '../client/src/PrivacyPanel';
import PrivacyRequestsAdmin from '../client/src/PrivacyRequestsAdmin';
const mocked=vi.hoisted(()=>({api:vi.fn(),notify:vi.fn()}));
vi.mock('../client/src/lib',async original=>({...await original<typeof import('../client/src/lib')>(),api:mocked.api}));
let box:HTMLDivElement,root:Root;
const request={id:'local-request',type:'export',status:'received',response:'',createdAt:1770000000,updatedAt:1770000000,dueAt:1770600000,downloadable:false};
const summary={enabled:true,policyVersion:'synthetic-v1',requests:[],consents:[]};
async function flush(){await act(async()=>{for(let i=0;i<10;i++)await Promise.resolve();});}
async function toggle(){await act(async()=>{const node=box.querySelector('details')!;node.open=true;node.dispatchEvent(new Event('toggle'));});await flush();}
async function click(text:string){const b=[...box.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===text);expect(b).toBeDefined();await act(async()=>b!.click());await flush();}
async function render(content:React.ReactNode,lang:'ar'|'en'='ar'){await act(async()=>root.render(<AppContext.Provider value={{user:{id:1,role:'owner'} as any,lang,t:(ar,en)=>lang==='ar'?ar:en,notify:mocked.notify,refresh:async()=>{}}}>{content}</AppContext.Provider>));}
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;box=document.createElement('div');document.body.appendChild(box);root=createRoot(box);mocked.api.mockReset();mocked.notify.mockClear();});
afterEach(async()=>{await act(async()=>root.unmount());box.remove();vi.restoreAllMocks();});
describe('Privacy spaces — local DOM only, no browser/live actions',()=>{
  it('starts as one collapsed control with no request and reuses existing preference content only inside it',async()=>{
    mocked.api.mockResolvedValue(summary);await render(<PrivacyPanel><div>تفضيلات الموافقات القائمة</div></PrivacyPanel>);
    expect(box.textContent).toBe('خصوصيتي وبياناتي');expect(mocked.api).not.toHaveBeenCalled();await toggle();expect(mocked.api).toHaveBeenCalledWith('/api/privacy/summary',expect.objectContaining({signal:expect.any(AbortSignal)}));expect(box.textContent).toContain('تفضيلات الموافقات القائمة');
  });
  it('does not show an automatic download or ready claim after registration',async()=>{
    mocked.api.mockImplementation(async(path:string)=>path==='/api/privacy/requests'?{request,idempotent:false}:{...summary,requests:[request]});
    await render(<PrivacyPanel/>);await toggle();await click('طلب نسخة بياناتي');
    const calls=mocked.api.mock.calls.filter(([path])=>path==='/api/privacy/requests');expect(calls).toHaveLength(1);expect(JSON.parse(calls[0][1].body)).toMatchObject({type:'export',message:''});expect(box.textContent).toContain('استلمنا طلبك');expect(box.textContent).not.toContain('تنزيل نسختي');expect(mocked.api.mock.calls.some(([path])=>String(path).includes('/download'))).toBe(false);
  });
  it('shows the support path and existing choices but no disabled new request buttons',async()=>{
    mocked.api.mockResolvedValue({...summary,enabled:false});await render(<PrivacyPanel><div>تفضيلات قائمة</div></PrivacyPanel>);await toggle();expect(box.textContent).not.toContain('طلب نسخة بياناتي');expect(box.querySelector('a')?.getAttribute('href')).toBe('mailto:support@ksa.men');expect(box.textContent).toContain('تفضيلات قائمة');
  });
  it('displays an explained blocked result without calling it a successful erasure',async()=>{
    mocked.api.mockImplementation(async(path:string)=>path==='/api/privacy/summary'?{...summary,requests:[{...request,type:'erasure',status:'blocked'}]}:{request:{...request,type:'erasure',status:'blocked',response:'نحتاج مراجعة سند الاحتفاظ'},message:'طلبي',events:[{status:'blocked',code:'administrator_reply',createdAt:1770000000}]});
    await render(<PrivacyPanel/>);await toggle();await click('تفاصيل الطلب');expect(box.textContent).toContain('تحتاج متابعة');expect(box.textContent).toContain('نحتاج مراجعة سند الاحتفاظ');expect(box.textContent).not.toContain('تم حذف');expect(box.textContent).not.toContain('administrator_reply');
  });
  it('loads only the opened administrative detail and never exposes a manual ready/export control',async()=>{
    mocked.api.mockImplementation(async(path:string)=>path==='/api/admin/privacy/requests'?{enabled:true,requests:[{...request,name:'اختبار'}],nextAfter:null}:{request:{...request,message:'',response:'',revision:1,subjectId:1}});
    await render(<PrivacyRequestsAdmin/>);expect(mocked.api).not.toHaveBeenCalled();await toggle();expect(mocked.api.mock.calls.filter(([path])=>path==='/api/admin/privacy/requests')).toHaveLength(1);await click('فتح التفاصيل');expect(mocked.api).toHaveBeenCalledWith('/api/admin/privacy/requests/local-request');expect(box.textContent).not.toContain('حفظ الرد والمتابعة');expect(box.querySelector('select')).toBeNull();
  });
  it('keeps the data space and status copy in English when English is selected',async()=>{
    mocked.api.mockResolvedValue({...summary,requests:[request]});await render(<PrivacyPanel/>,'en');await toggle();expect(box.textContent).toContain('My privacy and data');expect(box.textContent).toContain('Request received');expect(box.textContent).not.toContain('خصوصيتي');
  });
});

describe('Scoped removal follow-up — local DOM',()=>{
 it('shows a scoped incomplete result and support reference without claiming all data was erased',async()=>{
  const outcome={scope:'site',operationRecorded:true,recordsRetained:true,fullErasureVerified:false,executedAt:1770000000,media:{total:2,removed:1,pending:1,failed:0,state:'pending'}};
  mocked.api.mockImplementation(async(path:string)=>path==='/api/privacy/summary'?{...summary,requests:[{...request,type:'erasure',status:'answered'}]}:{request:{...request,type:'erasure',status:'answered'},message:'',events:[],outcome});
  await render(<PrivacyPanel/>);await toggle();await click('تفاصيل الطلب');expect(box.textContent).toContain('إزالة موقع محدد');expect(box.textContent).toContain('ليست إثبات محو جميع البيانات والنسخ');expect(box.textContent).toContain('مرجع الطلب');expect(box.textContent).toContain('لا يعاد تفعيل دخولك السابق');expect(mocked.api.mock.calls.some(([path])=>String(path).includes('/erase'))).toBe(false);
 });
 it('does not fetch candidate operations until asked, and links only after an explicit choice',async()=>{
  const op={id:'synthetic-operation',scope:'site',executedAt:1770000000};let linked=false;
  const outcome={scope:'site',operationRecorded:true,recordsRetained:true,fullErasureVerified:false,executedAt:1770000000,media:{total:0,removed:0,pending:0,failed:0,state:'verified'}};
  mocked.api.mockImplementation(async(path:string)=>path==='/api/admin/privacy/requests'?{enabled:true,requests:[{...request,type:'erasure',name:'اختبار'}]}:path.endsWith('/erasure-options')?{operations:[op]}:path.endsWith('/link-erasure')?(linked=true,{linked:true,outcome}):{request:{...request,type:'erasure',status:linked?'answered':'received',subjectId:1,message:'',revision:1,outcome:linked?outcome:null}});
  await render(<PrivacyRequestsAdmin/>);await toggle();await click('فتح التفاصيل');expect(mocked.api.mock.calls.some(([path])=>String(path).endsWith('/erasure-options'))).toBe(false);
  await click('استحضار العمليات المتاحة');const button=[...box.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='ربط النتيجة بهذا الطلب')!;expect(button.disabled).toBe(true);
  const select=[...box.querySelectorAll<HTMLSelectElement>('select')].find(s=>[...s.options].some(o=>o.value===op.id))!;await act(async()=>{select.value=op.id;select.dispatchEvent(new Event('change',{bubbles:true}));});await click('ربط النتيجة بهذا الطلب');
  const calls=mocked.api.mock.calls.filter(([path])=>String(path).endsWith('/link-erasure'));expect(calls).toHaveLength(1);expect(JSON.parse(calls[0][1].body)).toEqual({deletionRequestId:op.id,expectedRevision:1});expect(mocked.api.mock.calls.some(([path])=>String(path).endsWith('/erase'))).toBe(false);expect(box.textContent).toContain('إزالة موقع محدد');
 });
});
