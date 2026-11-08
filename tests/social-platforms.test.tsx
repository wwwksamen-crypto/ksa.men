// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {socialPlatforms,orderedSocialLinks,validateSocialOverrides,socialOverrides} from '../shared/social-platforms';
import {brandPaths} from '../client/src/brand-paths';
vi.mock('../client/src/lib',()=>({api:vi.fn(),useApp:()=>({t:(a:string)=>a,notify:vi.fn(),lang:'ar'})}));
import SocialIconGrid from '../client/src/SocialIconGrid';
let root:Root,host:HTMLDivElement;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
describe('The eight original social icons',()=>{
 it('has the exact approved order and original platform defaults without inventing member accounts',()=>{
  expect(socialPlatforms.map(x=>x.key)).toEqual(['linkedin','facebook','instagram','snapchat','tiktok','x','youtube','telegram']);expect(orderedSocialLinks([])).toHaveLength(8);expect(orderedSocialLinks([]).every(x=>x.isDefault)).toBe(true);expect(orderedSocialLinks([])[7].url).toBe('https://telegram.org/');
 });
 it('replaces only matching member icons, retaining their exact destinations and keeping the remaining defaults',()=>{
  const links=[{url:'https://linkedin.com/in/local',label:'مهني'},'https://x.com/local','javascript:alert(1)'];const before=JSON.stringify(links);const ordered=orderedSocialLinks(links);expect(ordered[0].url).toBe('https://linkedin.com/in/local');expect(ordered[5].url).toBe('https://x.com/local');expect(ordered.filter(x=>x.isDefault)).toHaveLength(6);expect(JSON.stringify(links)).toBe(before);
 });
 it('strictly validates HTTPS, corresponding original hosts, credentials and unknown keys',()=>{
  expect(validateSocialOverrides({linkedin:'https://www.linkedin.com/company/local',telegram:'https://telegram.org/'}).linkedin).toContain('/company/local');expect(()=>validateSocialOverrides({x:'https://x.com.evil.example/'})).toThrow();expect(()=>validateSocialOverrides({x:'javascript:alert(1)'})).toThrow();expect(()=>validateSocialOverrides({x:'https://user:password@x.com/local'})).toThrow();expect(()=>validateSocialOverrides({x:'http://x.com/local'})).toThrow();expect(()=>validateSocialOverrides({unknown:'https://x.com/'})).toThrow();expect(socialOverrides({x:'javascript:alert(1)',secret:'PRIVATE'})).toEqual({});
 });
 it('renders precisely eight original icon paths and accessible homepage labels, no third-party images',async()=>{
  await act(async()=>root.render(<SocialIconGrid/>));const links=Array.from(host.querySelectorAll('a'));expect(links).toHaveLength(8);for(let i=0;i<links.length;i++){expect(links[i].querySelector('path')?.getAttribute('d')).toBe(brandPaths[socialPlatforms[i].key]);expect(links[i].getAttribute('aria-label')).toContain('الموقع الرسمي');expect(links[i].getAttribute('rel')).toBe('noopener noreferrer');}expect(host.querySelector('img')).toBeNull();
 });
});
