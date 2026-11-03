// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock('../client/src/lib', () => ({ api: apiMock, useApp: () => ({ lang:'ar', t:(ar:string)=>ar, notify:vi.fn() }), Button: ({children,...props}:any)=><button {...props}>{children}</button> }));
vi.mock('qrcode', () => ({ toDataURL: vi.fn(async () => 'data:image/png;base64,local') }));
import { IdentityView } from '../client/src/Personal';
import { PreviewModal, parseDraft, LinkList } from '../client/src/Dashboard';
import { sanitizeProfile, profileItemIds } from '../shared/profile-visibility';
import { brandPaths } from '../client/src/brand-paths';
let container:HTMLDivElement, root:Root;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const fixture = {name:'هوية اختبار',title:'مختص',bio:'نبذة كاملة',city:'الرياض',country:'السعودية',photo:'/assets/logo-emblem.webp',cover:'/assets/cover-1600.webp',experience:[{title:'خبرة',organization:'جهة',start:'2020',end:'2025'}],education:[{title:'تعليم',start:'2015',end:'2019'}],training:['دورة محلية'],timeline:[{title:'محطة مهنية',start:'2024'}],skills:['تحليل عام',{name:'قيادة',level:'متقدم'}],skillRadar:{human:['تواصل'],scientific:['إحصاء','تحليل بيانات'],professional:['هندسة']},memberships:[{title:'عضوية مختصة',description:'عضو مهني'}],languages:[{language:'العربية',level:'لغة أم'}],hobbies:[{label:'قراءة'}],achievements:[{title:'إنجاز محلي'}],blog:'فكرة للمدونة',notes:'PRIVATE NOTE OUTSIDE VISITOR VIEW',socials:[{url:'https://x.com/local-member'},{url:'https://instagram.com/local-member'},{url:'https://linkedin.com/in/local-member'}],buttons:['https://example.com/resource',{label:'وجهتي',url:'https://example.org/'}],skillImages:['/api/media/local-skill'],workImages:['/api/media/local-work'],youtube:'https://youtube.com/@local-member',allowContact:true};
beforeEach(() => { apiMock.mockReset(); container=document.createElement('div');document.body.append(container);root=createRoot(container); Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(){this.setAttribute('open','');}}); Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(){this.removeAttribute('open');}}); });
afterEach(async () => { await act(async()=>root.unmount());container.remove();vi.restoreAllMocks(); });
async function render(profile:any, previewMode=true) { await act(async()=>root.render(<IdentityView previewMode={previewMode} data={{profile,name:'local-profile',site:'local-site'}}/>)); }
describe('the same complete visitor view in a local draft preview', () => {
  it('shows every completed section and real three-axis skill counts, not fabricated ratings', async () => {
    await render(sanitizeProfile(fixture));
    for(const value of ['نبذة كاملة','خبرة','تعليم','دورة محلية','محطة مهنية','تحليل عام','قيادة — متقدم','عضوية مختصة — عضو مهني','العربية — لغة أم','قراءة','إنجاز محلي','فكرة للمدونة','وجهتي']) expect(container.textContent,value).toContain(value);
    expect(container.querySelector('.identity-radar-plot svg')?.getAttribute('aria-label')).toBe('إنسانية: 1، علمية: 2، مهنية: 1');
    expect(container.querySelectorAll('.identity-gallery__item img')).toHaveLength(2);
    expect(container.querySelectorAll('.identity-timeline__period bdi')).toHaveLength(5);
    expect(container.textContent).not.toContain('PRIVATE NOTE'); expect(apiMock).not.toHaveBeenCalled();
  });
  it('shows original icon-only platform links from their URLs without requiring labels or preloading YouTube', async () => {
    await render(sanitizeProfile(fixture));
    const x=container.querySelector<HTMLAnchorElement>('.identity-social-icons a[href="https://x.com/local-member"]')!;
    expect(x).not.toBeNull(); expect(x.textContent).toBe('');expect(x.getAttribute('aria-label')).toContain('X'); expect(x.querySelector('path')?.getAttribute('d')).toBe(brandPaths.x);
    const youtube=container.querySelector<HTMLAnchorElement>('.identity-social-icons a[href="https://youtube.com/@local-member"]')!;
    expect(youtube.getAttribute('aria-label')).toContain('YouTube'); expect(youtube.textContent).toBe('');
    expect(container.querySelector('iframe')).toBeNull(); expect(container.querySelector('.identity-video__launch')).toBeNull();
    expect([...container.querySelectorAll('img')].some(image=>image.src.includes('youtube'))).toBe(false);
  });
  it('opens a video only after an explicit play selection and keeps a channel as an external link', async () => {
    await render({...fixture,youtube:'https://youtu.be/abcdefghijk'});
    expect(container.querySelector('iframe')).toBeNull();
    await act(async()=>container.querySelector<HTMLButtonElement>('.identity-video__launch')!.click());
    expect(container.querySelector('iframe')?.src).toBe('https://www.youtube-nocookie.com/embed/abcdefghijk');expect(apiMock).not.toHaveBeenCalled();
  });
  it('hides chosen items, image and field while retaining other sections and does not render unsafe destinations', async () => {
    const ids=profileItemIds(fixture);
    const profile=sanitizeProfile({...fixture,hidden:['blog'],hiddenItems:[`skillImages:${ids.skillImages[0]}`,`skills:${ids.skills[1]}`],socials:[...fixture.socials,{url:'javascript:alert(1)'}],buttons:[{label:'غير آمن',url:'javascript:alert(1)'}]});
    await render(profile);
    expect(container.textContent).not.toContain('قيادة');expect(container.textContent).not.toContain('فكرة للمدونة'); expect(container.querySelector('#skill-evidence')).toBeNull();
    expect(container.querySelector('#work-samples img')?.getAttribute('src')).toBe('/api/media/local-work');expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });
  it('renders the same full view in the member dialog, with notes only in the clearly private area outside it', async () => {
    const draft=parseDraft(fixture);
    await act(async()=>root.render(<PreviewModal draft={draft} site={{id:'local-site',name:'local-profile'}} tr={ar=>ar} submitting={false} onClose={()=>{}} onSubmit={()=>{}}/>));
    const publicView=container.querySelector('.identity-page')!;
    expect(publicView.querySelector('#work-samples')).not.toBeNull();expect(publicView.querySelector('#memberships')).not.toBeNull();expect(publicView.querySelector('.identity-radar-plot')).not.toBeNull();
    expect(publicView.textContent).not.toContain('PRIVATE NOTE');expect(container.querySelector('.dashboard-preview-private')?.textContent).toContain('PRIVATE NOTE');expect(apiMock).not.toHaveBeenCalled();
  });
  it('provides optional image descriptions in the same preview/public view without leaking descriptions of hidden images', async () => {
    const descriptions = {'/api/media/local-skill':'شهادة مهنية بوصف واضح','/api/media/local-work':'مشروع موثق بوصف واضح'};
    await render(sanitizeProfile({...fixture,imageDescriptions:descriptions}));
    expect(container.querySelector('#skill-evidence img')?.getAttribute('alt')).toBe(descriptions['/api/media/local-skill']);
    const ids=profileItemIds(fixture);
    const hidden=sanitizeProfile({...fixture,imageDescriptions:descriptions,hiddenItems:[`skillImages:${ids.skillImages[0]}`]});
    expect(hidden.imageDescriptions).toEqual({'/api/media/local-work':descriptions['/api/media/local-work']});
    await render(hidden);expect(container.querySelector('#skill-evidence')).toBeNull();
    expect(container.querySelector('#work-samples img')?.getAttribute('alt')).toBe(descriptions['/api/media/local-work']);
  });
  it('does not demand or render an unnecessary label input in social-link entry', async () => {
    await act(async()=>root.render(<LinkList socialOnly title="روابط" hint="" value={[{label:'',url:'https://x.com/local-member'}]} onChange={()=>{}} max={12} tr={ar=>ar}/>));
    expect(container.querySelectorAll('input')).toHaveLength(1);expect(container.querySelector('path')?.getAttribute('d')).toBeTruthy();
  });
});
