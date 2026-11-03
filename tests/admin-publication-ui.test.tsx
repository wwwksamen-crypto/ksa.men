// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import Admin from '../client/src/Admin';
import { api, AppContext } from '../client/src/lib';
vi.mock('../client/src/lib', async original => ({ ...await original<typeof import('../client/src/lib')>(), api: vi.fn() }));
const t=(ar:string,_en:string)=>ar, notify=vi.fn();
const user:any={id:1,role:'owner',name:'مالك محلي',email:'owner@local.invalid',status:'active'};
let container:HTMLDivElement,root:Root,published:boolean;
const account=()=>({id:8,name:'عضو محلي',email:'member@local.invalid',status:'active',role:'user',site_id:'local-site',subdomain:'local-member',site_status:published?'published':'draft',site_url:published?'https://local-member.ksa.men':null});
const flush=async()=>{await act(async()=>{for(let i=0;i<16;i++)await Promise.resolve();});};
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;history.replaceState({},'', '/admin');published=false;notify.mockReset();
  container=document.createElement('div');document.body.append(container);root=createRoot(container);
  vi.mocked(api).mockReset().mockImplementation(async(path,options={})=>{
    if(path.startsWith('/api/admin/users'))return {users:[account()]} as any;
    if(path==='/api/services')return [] as any;
    if(path==='/api/admin/sites/local-site/publish'){expect(options.method).toBe('POST');published=true;return {published:true,url:'https://local-member.ksa.men'} as any;}
    return {} as any;
  });
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
async function usersTab(){
  await act(async()=>root.render(<AppContext.Provider value={{user,lang:'ar',t,notify,refresh:async()=>{}}}><Admin/></AppContext.Provider>));await flush();
  await act(async()=>[...container.querySelectorAll<HTMLButtonElement>('.admin-sidebar button')].find(button=>button.textContent?.includes('المستخدمون'))!.click());await flush();
}
describe('one-click administrative publication — DOM and mocked API',()=>{
  it.each(['list','detail'])('publishes from the %s card without opening Reviews or showing false success',async place=>{
    await usersTab();
    if(place==='detail'){await act(async()=>container.querySelector<HTMLButtonElement>('.admin-user-card-open')!.click());await flush();}
    const parent=place==='list'?'.admin-user-list':'.admin-user-detail';
    await act(async()=>[...container.querySelectorAll<HTMLButtonElement>(parent+' button')].find(button=>button.textContent==='نشر الموقع')!.click());await flush();
    expect(published).toBe(true);
    expect(vi.mocked(api).mock.calls.filter(([path])=>path==='/api/admin/sites/local-site/publish')).toHaveLength(1);
    expect(vi.mocked(api).mock.calls.some(([path])=>path.includes('/reviews')||path.includes('/auth/'))).toBe(false);
    expect(notify).toHaveBeenCalledWith('تم نشر الموقع.');
    if(place==='detail'){
      expect(container.querySelector('.admin-user-detail')?.textContent).toContain('منشور');
      expect(container.querySelector('.admin-user-detail a[href="https://local-member.ksa.men"]')).not.toBeNull();
      expect(container.querySelector('.admin-user-detail')?.textContent).not.toContain('من المراجعات');
    }
    expect(container.querySelector('button button')).toBeNull();
  });
});
