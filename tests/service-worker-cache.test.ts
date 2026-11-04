import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const code=readFileSync('public/sw.js','utf8');
function setup(){
 const handlers:Record<string,Function>={},saved=new Map<string,Response>();
 const cache={match:vi.fn(async(request:any)=>saved.get(typeof request==='string'?'https://ksa.men'+request:request.url)?.clone()),put:vi.fn(async(request:any,response:Response)=>{saved.set(typeof request==='string'?'https://ksa.men'+request:request.url,response.clone());}),keys:vi.fn(async()=>[...saved.keys()].map(url=>new Request(url))),delete:vi.fn(async(request:Request)=>saved.delete(request.url)),add:vi.fn(async()=>{})};
 const fetch=vi.fn(async()=>new Response('fresh bytes',{headers:{'Content-Type':'text/css','Cache-Control':'public, max-age=3600'}}));
 runInNewContext(code,{self:{location:{origin:'https://ksa.men'},addEventListener:(event:string,handler:Function)=>{handlers[event]=handler;},clients:{claim:async()=>{}},skipWaiting:vi.fn()},caches:{open:async()=>cache,match:async()=>null,keys:async()=>['ksa-static-old','unrelated'],delete:vi.fn()},fetch,URL,Response,Headers,Request,Date,Promise});
 async function event(url:string,options:any={}){let result:Promise<Response>|undefined;const request=new Request(url,options);if(options.navigate)Object.defineProperty(request,'mode',{value:'navigate'});handlers.fetch({request,respondWith:(p:Promise<Response>)=>{result=p;}});return result?await result:undefined;}
 return{event,cache,fetch,saved};
}
describe('Public asset cache only — isolated worker events',()=>{
 it('never intercepts API, media, foreign origins, sensitive documents or ranged requests',async()=>{
  const s=setup();for(const url of['https://ksa.men/api/public/profile','https://ksa.men/api/media/private','https://else.invalid/assets/image.png','https://ksa.men/assets/company-registration.webp'])expect(await s.event(url)).toBeUndefined();expect(await s.event('https://ksa.men/assets/photo.webp',{headers:{Range:'bytes=0-100'}})).toBeUndefined();expect(s.fetch).not.toHaveBeenCalled();expect(s.cache.put).not.toHaveBeenCalled();
 });
 it('never saves short or legacy introduction pages and never intercepts their private API',async()=>{
  const s=setup();for(const path of ['/q/abcdefghijklmnop','/quick/610ea163-ce4a-4b24-bccb-006ddbb22fe8','/api/public/quick/abcdefghijklmnop'])expect(await s.event('https://ksa.men'+path)).toBeUndefined();
  for(const path of ['/q/abcdefghijklmnop','/quick/610ea163-ce4a-4b24-bccb-006ddbb22fe8'])expect(await s.event('https://ksa.men'+path,{navigate:true})).toBeInstanceOf(Response);
  expect(s.fetch).toHaveBeenCalledTimes(2);expect(s.fetch.mock.calls.every((args:any)=>args[1].cache==='no-store')).toBe(true);
  expect(s.cache.put).not.toHaveBeenCalled();
 });
 it('reuses a fresh fixed public asset, but fetches it again after its bounded age',async()=>{
  const s=setup(),url='https://ksa.men/assets/logo.webp';await s.event(url);expect(s.fetch).toHaveBeenCalledTimes(1);expect(await (await s.event(url))!.text()).toBe('fresh bytes');expect(s.fetch).toHaveBeenCalledTimes(1);
  s.saved.set(url,new Response('old',{headers:{'Cache-Control':'public, max-age=3600','X-KSA-Cached-At':String(Date.now()-3601000)}}));await s.event(url);expect(s.fetch).toHaveBeenCalledTimes(2);
 });
 it('allows immutable cache only for fingerprinted JS/CSS and honors explicit reload/no-store requests',async()=>{
  const s=setup(),url='https://ksa.men/assets/main-12345678.js';s.saved.set(url,new Response('hashed',{headers:{'Cache-Control':'public, max-age=31536000, immutable'}}));expect(await(await s.event(url))!.text()).toBe('hashed');expect(s.fetch).not.toHaveBeenCalled();await s.event(url,{cache:'reload'});expect(s.fetch).toHaveBeenCalledTimes(1);await s.event(url,{cache:'no-store'});expect(s.fetch).toHaveBeenCalledTimes(2);expect(s.cache.put).toHaveBeenCalledTimes(1);
 });
 it('does not cache HTML, errors or private/no-store responses and never replaces a live refusal with saved data',async()=>{
  const s=setup(),url='https://ksa.men/assets/logo.webp';s.saved.set(url,new Response('old',{headers:{'X-KSA-Cached-At':'1'}}));for(const response of[new Response('refused',{status:404}),new Response('private',{headers:{'Cache-Control':'private, no-store'}}),new Response('<html/>',{headers:{'Cache-Control':'public, max-age=3600','Content-Type':'text/html'}})]){s.fetch.mockResolvedValueOnce(response);expect(await(await s.event(url))!.text()).not.toBe('old');}expect(s.cache.put).not.toHaveBeenCalled();
 });
});
