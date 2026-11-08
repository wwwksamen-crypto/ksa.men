// @vitest-environment jsdom
import {act} from 'react';
import React from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,describe,it,expect,vi} from 'vitest';
import SiteNameEditor from '../client/src/SiteNameEditor';
import AdminSubdomainRedirects from '../client/src/AdminSubdomainRedirects';
const mocks=vi.hoisted(()=>({role:'owner',api:vi.fn().mockResolvedValue({pending:null,redirects:[]})}));
vi.mock('../client/src/lib',()=>({api:mocks.api,useApp:()=>({t:(ar:string)=>ar,user:{role:mocks.role},notify:vi.fn()})}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|undefined,div:HTMLDivElement;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());div?.remove();root=undefined;mocks.role='owner';vi.clearAllMocks();});
async function mount(node:React.ReactNode){div=document.createElement('div');document.body.appendChild(div);root=createRoot(div);await act(async()=>root!.render(node));}
describe('scoped name and redirect UI, mocked API only',()=>{
 it('shows edit and publication under the link, retains a mounted input, and submits a normalized full name',async()=>{const request=vi.fn().mockResolvedValue(true);await mount(<SiteNameEditor siteId="fixture" currentName="999" disabled={false} onRequest={request} onPublish={vi.fn()}/>);let buttons=[...div.querySelectorAll('button')];expect(buttons.map(b=>b.textContent)).toEqual(['تعديل','طلب نشر']);await act(async()=>buttons[0].click());const input=div.querySelector('input')!;expect(input.value).toBe('999');await act(async()=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;setter.call(input,'NEW.KSA.MEN');input.dispatchEvent(new Event('input',{bubbles:true}));});expect(div.querySelector('input')).toBe(input);await act(async()=>div.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(request).toHaveBeenCalledWith('new');});
 it('blocks name action while the existing upload/publication guard is active',async()=>{await mount(<SiteNameEditor siteId="fixture" currentName="999" disabled={true} onRequest={vi.fn()} onPublish={vi.fn()}/>);expect([...div.querySelectorAll('button')].every(b=>b.disabled)).toBe(true);});
 it('offers complete link and destination to owner but not to a member',async()=>{await mount(<AdminSubdomainRedirects/>);expect(div.textContent).toContain('حجز وتفعيل');expect(div.querySelector('input')?.placeholder).toBe('VIP.KSA.MEN');mocks.role='user';await act(async()=>root!.render(<AdminSubdomainRedirects/>));expect(div.textContent).toBe('');});
});
