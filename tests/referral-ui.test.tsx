// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mock=vi.hoisted(()=>({requests:[] as Array<[string,any]>,notify:vi.fn()}));
vi.mock('../client/src/lib',()=>({
 useApp:()=>({user:null,t:(ar:string)=>ar,refresh:vi.fn(),notify:mock.notify,lang:'ar'}),
 api:vi.fn(async(path:string,options?:any)=>{mock.requests.push([path,options]);if(path==='/api/referrals')return {url:'https://ksa.men/auth?register=1&ref=C42',code:'C42',visits:17,registered:3,eligible:1,rewarded:1,cancelled:0,pointsRecovered:0,pointsOutstanding:0,rewardPoints:1000};return {ok:true,challenge:'fixture',message:'fixture'};}),
 Button:({children,...props}:any)=><button {...props}>{children}</button>,setCSRF:vi.fn(),
}));
import AuthPanel from '../client/src/AuthPanel';
import ReferralPanel from '../client/src/ReferralPanel';
let host:HTMLDivElement,root:Root;
async function mount(view:React.ReactNode){await act(async()=>{root.render(view);await new Promise(r=>setTimeout(r,0));});}
async function click(label:string){const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent===label)!;expect(button).toBeTruthy();await act(async()=>button.click());}
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;mock.requests=[];localStorage.clear();history.replaceState({},'', '/auth?ref=C42');host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
describe('Referral and conversion controls',()=>{
 it('opens legacy invitation links in registration, preserving explicit age, eligibility and policy affirmations',async()=>{await mount(<AuthPanel/>);expect(host.textContent).toContain('أنشئ موقعك');expect(host.querySelector('[name="name"]')).toBeTruthy();expect(host.querySelector('[name="whatsapp"]')).toBeNull();expect(host.querySelector('#registration-privacy-notice a[href="/privacy"]')).toBeTruthy();expect(host.querySelector('.check-label a[href="/privacy"]')).toBeNull();expect(mock.requests.filter(([p])=>p.includes('referral-visit'))).toHaveLength(0);expect(host.querySelector('input[type="checkbox"]')).toHaveProperty('checked',false);expect(host.textContent).toContain('18');await click('إزالة الدعوة');expect(localStorage.length).toBe(0);expect(host.textContent).not.toContain('وصلت عبر دعوة');});
 it('does not alter plain login or sensitive embedded return flows',async()=>{history.replaceState({},'','/auth');await mount(<AuthPanel/>);expect(host.textContent).toContain('عوداً مرحباً');expect(host.querySelector('[name="name"]')).toBeNull();await mount(<AuthPanel key="sensitive-return" embedded purpose="reauth"/>);expect(host.textContent).toContain('أكمل تأكيد حسابك');expect(mock.requests.filter(([p])=>p.includes('referral-visit'))).toHaveLength(0);});
 it('shows only real aggregate counters with no invitee names and copies the valid registration URL',async()=>{const copy=vi.fn(async()=>{});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}});await mount(<ReferralPanel/>);expect(host.textContent).toContain('دعوة تصنع حضوراً');expect(host.textContent).toContain('فتح الدعوة');expect(host.textContent).toContain('ليس عدد أشخاص فريدين');expect(host.querySelectorAll('dd')).toHaveLength(4);expect(host.textContent).not.toContain('البريد الإلكتروني');await click('نسخ الرابط');expect(copy).toHaveBeenCalledWith('https://ksa.men/auth?register=1&ref=C42');});
});
