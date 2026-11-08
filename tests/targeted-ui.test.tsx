// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MembershipOffer from '../client/src/MembershipOffer';
import IdentityExportActions from '../client/src/IdentityExportActions';
import AuthPanel from '../client/src/AuthPanel';
import { publicInstitutionalContact } from '../shared/institutional-contact';
vi.mock('../client/src/lib',()=>({useApp:()=>({t:(ar:string)=>ar,lang:'ar',user:null,notify:vi.fn(),refresh:vi.fn()}),api:vi.fn(),setCSRF:vi.fn(),Button:({children,...props}:any)=><button {...props}>{children}</button>}));
describe('targeted public UI outcomes',()=>{
 it('shows the approved trial and both prices with no payment-card requirement',()=>{
  const html=renderToStaticMarkup(<MembershipOffer/>);expect(html).toContain('13');expect(html).toContain('96');expect(html).toContain('<del>156</del>');expect(html).toContain('دون بطاقة دفع');expect(html).toContain('يظل موقعك الأساسي');expect(html).toContain('href="/start"');
 });
 it('offers immediate PDF/ATS and both badge downloads, but respects every hidden output',()=>{
  const visible=renderToStaticMarkup(<IdentityExportActions name="999"/>);expect(visible).toContain('تنزيل البروفايل الفاخر');expect(visible).toContain('تنزيل السيرة الذاتية');expect(visible).toContain('بطاقة معرض رقمية');expect(visible).toContain('بطاقة معرض للطباعة');
  expect(renderToStaticMarkup(<IdentityExportActions name="999" downloads={{profile:false,ats:false,badge:false,vcard:true}}/>)).toBe('');
 });
 it('separates staff login from public registration without advertising an admin registration action',()=>{
  window.history.replaceState({},'', '/admin');const staff=renderToStaticMarkup(<AuthPanel audience="staff"/>);expect(staff).toContain('دخول الإدارة والإشراف');expect(staff).not.toContain('جديد هنا؟');
  window.history.replaceState({},'', '/start');const signup=renderToStaticMarkup(<AuthPanel/>);expect(signup).toContain('اسمك');expect(signup).toContain('سياسة الخصوصية');
 });
 it('projects both institutional addresses while retaining the existing whatsapp contact',()=>{
  expect(publicInstitutionalContact({email:'legacy@gmail.com',whatsapp:'966555444959'})).toEqual({email:'support@ksa.men',executiveEmail:'ceo@ksa.men',whatsapp:'966555444959'});
 });
});
