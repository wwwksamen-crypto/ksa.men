import RequestRemovalRecords from '../client/src/RequestRemovalRecords';
// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import RequestRemovalButton from '../client/src/RequestRemovalButton';
import { api, AppContext } from '../client/src/lib';
vi.mock('../client/src/lib', async original => ({ ...await original<typeof import('../client/src/lib')>(), api: vi.fn() }));
let box: HTMLDivElement, root: Root;
const notify = vi.fn(), removed = vi.fn();
const flush = async () => { await act(async () => { for (let i=0;i<10;i++) await Promise.resolve(); }); };
async function mount() { await act(async () => root.render(<AppContext.Provider value={{ user: { id: 1, role: 'owner' } as any, lang: 'ar', t: ar => ar, notify, refresh: async () => {} }}><RequestRemovalButton kind="review" requestId="local-review" status="pending" onRemoved={removed}/></AppContext.Provider>)); }
async function click(text: string) { const b=[...box.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text)!; await act(async()=>b.click()); await flush(); }
async function reason() { const input=box.querySelector('textarea')!; await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'طلب صاحب الموقع');input.dispatchEvent(new Event('input',{bubbles:true}));}); }
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;box=document.createElement('div');document.body.append(box);root=createRoot(box);notify.mockReset();removed.mockReset();vi.mocked(api).mockReset();});
afterEach(async()=>{await act(async()=>root.unmount());box.remove();});
it('requires a reason and only executes one confirmed request before reporting success',async()=>{vi.mocked(api).mockResolvedValue({removed:true,proofId:'local-proof'}as any);await mount();await click('حذف الطلب');expect(box.querySelector('textarea')).not.toBeNull();expect([...box.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='حذف الطلب وتسجيل السبب')!.disabled).toBe(true);await reason();await click('حذف الطلب وتسجيل السبب');expect(api).toHaveBeenCalledTimes(1);expect(JSON.parse(vi.mocked(api).mock.calls[0][1]!.body as string)).toMatchObject({reason:'طلب صاحب الموقع',expectedStatus:'pending'});expect(removed).toHaveBeenCalledTimes(1);});
it('does not hide the row or announce success when the server does not confirm removal',async()=>{vi.mocked(api).mockResolvedValue({removed:false}as any);await mount();await click('حذف الطلب');await reason();await click('حذف الطلب وتسجيل السبب');expect(removed).not.toHaveBeenCalled();expect(box.querySelector('[role="alert"]')?.textContent).toContain('لم يتأكد');});
it('blocks repeated clicks while the one request is in flight',async()=>{let resolve!:(v:any)=>void;vi.mocked(api).mockImplementation(()=>new Promise(r=>resolve=r));await mount();await click('حذف الطلب');await reason();const button=[...box.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='حذف الطلب وتسجيل السبب')!;await act(async()=>{button.click();button.click();});expect(api).toHaveBeenCalledTimes(1);await act(async()=>resolve({removed:true,proofId:'local'}));await flush();});

it('loads request-removal evidence only after opening and exposes the recorded reason privately',async()=>{
 vi.mocked(api).mockResolvedValue({records:[{id:'proof',kind:'review',request_id:'request',actor_id:1,actor_name:'مشرف',reason:'طلب صديق',previous_status:'pending',before_hash:'local',created_at:1800000000}]}as any);
 await act(async()=>root.render(<AppContext.Provider value={{user:{id:1,role:'owner'}as any,lang:'ar',t:ar=>ar,notify,refresh:async()=>{}}}><RequestRemovalRecords/></AppContext.Provider>));
 expect(api).not.toHaveBeenCalled();await click('فتح سجل حذف الطلبات');expect(api).toHaveBeenCalledTimes(1);expect(box.textContent).toContain('طلب صديق');expect(box.textContent).toContain('تصدير الإثباتات المعروضة');
});
