// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import Admin from '../client/src/Admin';
import { api, AppContext } from '../client/src/lib';
vi.mock('../client/src/lib', async original => ({ ...await original<typeof import('../client/src/lib')>(), api: vi.fn() }));
const t=(ar:string,_en:string)=>ar, notify=vi.fn();
const user:any={id:1,role:'owner',name:'مالك محلي',email:'owner@local.invalid',status:'active'};
let container:HTMLDivElement,root:Root,settlement:string|null;
const entry=()=>({id:'request-local',user_id:8,kind:'annual_contact',name:'عضو محلي',email:'member@local.invalid',status:settlement?'approved':'pending',settlement,created_at:1800000000,entitlement_until:1800000000,member_note:''});
const flush=async()=>{await act(async()=>{for(let i=0;i<16;i++)await Promise.resolve();});};
beforeEach(()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;history.replaceState({},'', '/admin');settlement=null;notify.mockReset();
 container=document.createElement('div');document.body.append(container);root=createRoot(container);
 vi.mocked(api).mockReset().mockImplementation(async(path,options={})=>{
  if(path==='/api/admin/subscription-requests/request-local/decision') {const body=JSON.parse(options.body as string);settlement=body.settlement;return {status:'approved',settlement} as any;}
  if(path.startsWith('/api/admin/subscription-requests'))return {requests:[entry()]} as any;
  if(path==='/api/services')return [] as any;
  return {} as any;
 });
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
async function membershipTab(){
 await act(async()=>root.render(<AppContext.Provider value={{user,lang:'ar',t,notify,refresh:async()=>{}}}><Admin/></AppContext.Provider>));await flush();
 await act(async()=>[...container.querySelectorAll<HTMLButtonElement>('.admin-sidebar button')].find(button=>button.textContent?.includes('الطلبات'))!.click());await flush();
 await act(async()=>[...container.querySelectorAll<HTMLButtonElement>('.admin-subnavigation button')].find(button=>button.textContent?.includes('العضوية'))!.click());await flush();
}
describe('Simple annual approval — DOM and mocked API',()=>{
 it.each([['confirmed','اعتماد السداد'],['strategic','منحة استراتيجية']])('submits %s from one button without required receipt or note',async(mode,label)=>{
  await membershipTab();expect(container.querySelector('input[type="file"]')).toBeNull();expect(container.querySelector('.admin-membership-card textarea[required]')).toBeNull();
  const button=[...container.querySelectorAll<HTMLButtonElement>('.admin-membership-card button')].find(b=>b.textContent===label)!;
  await act(async()=>button.click());await flush();
  const calls=vi.mocked(api).mock.calls.filter(([path])=>path.endsWith('/request-local/decision'));expect(calls).toHaveLength(1);
  expect(JSON.parse(calls[0][1]!.body as string)).toEqual({decision:'approve',reason:'',settlement:mode});
  expect(settlement).toBe(mode);expect(notify).toHaveBeenCalled();
  expect(vi.mocked(api).mock.calls.some(([path])=>path.includes('/auth/')||path.includes('/media')||path.includes('/payments'))).toBe(false);
 });
 it('keeps clarification and rejection reasons explicit without making approval notes mandatory',async()=>{
  await membershipTab();await act(async()=>[...container.querySelectorAll<HTMLButtonElement>('.admin-membership-card button')].find(b=>b.textContent==='رفض')!.click());await flush();
  expect(vi.mocked(api).mock.calls.some(([path])=>path.endsWith('/decision'))).toBe(false);expect(container.textContent).toContain('اكتب سبب القرار أولاً.');
 });
});
