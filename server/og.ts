import { decorateHTML, profileBody, personSchema } from '../shared/seo';
import { siteVisibility } from './visibility';
import { shareImageData } from './share-image';
import { profileItemIds, withVisibility } from '../shared/profile-visibility';
import type { App, Ctx } from './core';
import { one, publicProfile, digest, role, siteFor } from './core';
import { HTTPException } from 'hono/http-exception';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import wasm from './vendor/resvg.wasm';

const escape=(text:string)=>text.replace(/[&<>"']/g,value=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[value]!));
let ready:Promise<void>|undefined;
const initialize=()=>ready||(ready=initWasm(wasm));
const b64=(bytes:Uint8Array)=>{let output='';for(let index=0;index<bytes.length;index+=4096)output+=String.fromCharCode(...bytes.slice(index,index+4096));return btoa(output);};
export function shareProfile(raw:any,lang:string){const original=typeof raw==='string'?JSON.parse(raw):raw;const translated=original?.translations?.[lang];return publicProfile(translated&&typeof translated==='object'?{...original,...translated,photo:original.photo,avatarMode:original.avatarMode,itemIds:profileItemIds(original),hiddenItems:original.hiddenItems,hidden:original.hidden}:original);}
export async function shareSite(c:Ctx,name:string){
 if(!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name))throw new HTTPException(404);
 const site:any=await one(c,"SELECT s.*,n.name,u.status AS owner_status FROM dns_names n JOIN sites s ON s.id=n.site_id LEFT JOIN users u ON u.id=COALESCE(s.user_id,n.owner_id) WHERE n.name=? AND s.status='published' AND s.published IS NOT NULL",name);
 if(!site||site.owner_status!=='active')throw new HTTPException(404);
 const policy=await siteVisibility(c,site);
 if(!policy.visible)throw new HTTPException(404);
 const raw=withVisibility(JSON.parse(site.published),policy);
 return {...site,visibility:policy,published:JSON.stringify(raw)};
}
const brandImage = '/assets/share-logo-1200-v1.png';
async function brandResponse(c: Ctx) {
  const response = await c.env.ASSETS.fetch(new Request(new URL(brandImage, c.req.url)));
  return new Response(response.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' } });
}
export async function renderShare(c: Ctx, site: any) {
  const lang = c.req.query('lang') === 'en' ? 'en' : 'ar';
  const profile = shareProfile(site.published, lang);
  const match = typeof profile.photo === 'string' ? /^\/api\/media\/([A-Za-z0-9_-]+)$/.exec(profile.photo) : null;
  if (!match) return brandResponse(c);
  const media: any = await one(c, "SELECT bucket_key,mime,size FROM media WHERE id=? AND site_id=? AND purpose!='receipt'", match[1], site.id);
  if (!media || Number(media.size) > 5_000_000) return brandResponse(c);
  const cacheKey = 'sharing/v2/' + site.id + '/' + site.published_version + '-' + lang + '-' + await digest(JSON.stringify(profile)) + '.png';
  const saved = await c.env.MEDIA.get(cacheKey);
  if (saved) return new Response(saved.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' } });
  try {
    const object = await c.env.MEDIA.get(media.bucket_key);
    if (!object) return brandResponse(c);
    const input = await shareImageData(new Uint8Array(await object.arrayBuffer()), media.mime);
    if (!input) return brandResponse(c);
    await initialize();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="white"/><image href="data:${input.mime};base64,${b64(input.bytes)}" x="80" y="55" width="1040" height="520" preserveAspectRatio="xMidYMid meet"/></svg>`;
    const renderer = new Resvg(svg, { fitTo: { mode: 'original' } });
    let png: Uint8Array;
    const image = renderer.render();
    try { png = new Uint8Array(image.asPng()); } finally { image.free(); renderer.free(); }
    await c.env.MEDIA.put(cacheKey, png, { httpMetadata: { contentType: 'image/png' }, customMetadata: { siteId: site.id, publishedVersion: String(site.published_version), lang } });
    return new Response(png.slice().buffer as ArrayBuffer, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' } });
  } catch {
    // Missing, corrupt or unsupported images must never cause a broken sharing preview.
    return brandResponse(c);
  }
}
export function registerOG(app:App){
 app.get('/api/public/og/:name',async c=>{const site=await shareSite(c,c.req.param('name'));if(site.lock_hash)throw new HTTPException(423,{message:'الموقع خاص، ولا تتوفر له صورة مشاركة عامة'});return renderShare(c,site);});
 app.get('/api/admin/sites/:id/share-image',async c=>{role(c,['owner','manager']);const site=await siteFor(c,c.req.param('id'));if(!site.published)throw new HTTPException(404);const named:any=await one(c,'SELECT name FROM dns_names WHERE site_id=? LIMIT 1',site.id);return renderShare(c,{...site,published:JSON.stringify(withVisibility(JSON.parse(site.published),await siteVisibility(c,site))),name:named?.name||'KSA.MEN'});});
}
export async function personalizedHTML(c:Ctx,html:string){
 const url=new URL(c.req.url),root=c.env.ROOT_DOMAIN;
 if(url.hostname===root)return html;
 const name=url.hostname.slice(0,-root.length-1);
 const site=await shareSite(c,name);
 if(site.lock_hash){c.header('X-Robots-Tag','noindex, nofollow');return decorateHTML(html,{title:'KSA.MEN — '+(c.req.query('lang')==='en'?'Private site':'موقع خاص'),description:'KSA.MEN',lang:c.req.query('lang')==='en'?'en':'ar',indexable:false});}
 const lang=url.searchParams.get('lang')==='en'?'en':'ar',profile=shareProfile(site.published,lang);
 const title=String(profile.name||'KSA.MEN')+(profile.title?' — '+String(profile.title):'');
 const description=String(profile.bio||(lang==='ar'?'هوية مهنية سعودية — ظهور رقمي يليق بك':'A Saudi professional identity — a presence worthy of you'));
 const canonical='https://'+name+'.'+root+'/'+(lang==='en'?'?lang=en':'');
 const image='https://'+root+'/api/public/og/'+name+'?lang='+lang+'&v='+site.published_version+'-'+(await digest(JSON.stringify(profile))).slice(0,16);
 const policy={...site.visibility,indexable:site.visibility.indexable&&c.get('platformLockMode')==='open'};
 if(!policy.indexable)c.header('X-Robots-Tag','noindex, nofollow');
 return decorateHTML(html,{title,description,url:canonical,image,lang,indexable:policy.indexable,type:'profile',alternate:'https://'+name+'.'+root+'/'+(lang==='en'?'':'?lang=en'),schema:policy.indexable?personSchema(profile,canonical):undefined},profileBody(profile,name,lang));
}

export function unavailableSiteHTML(c: Ctx): string {
 const english = c.req.query('lang') === 'en';
 const title = english ? 'This identity is not available' : 'هذه الهوية غير متاحة الآن';
 const message = english ? 'Please check the address or return to KSA.MEN.' : 'تحقق من الرابط أو عُد إلى منصة KSA.MEN.';
 const home = english ? 'Discover KSA.MEN' : 'العودة إلى KSA.MEN';
 const root = escape(c.env.ROOT_DOMAIN);
 return `<!doctype html><html lang="${english ? 'en' : 'ar'}" dir="${english ? 'ltr' : 'rtl'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title} — KSA.MEN</title><style>@font-face{font-family:Tajawal;src:url('/assets/Tajawal-Regular.ttf')}*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:#07120f;color:#f4f4ed;font-family:Tajawal,Arial,sans-serif;text-align:center}main{width:min(100%,480px);padding:clamp(24px,6vw,44px);border:1px solid #294438;border-radius:24px;background:linear-gradient(145deg,#10271b,#101f19)}img{width:120px;height:120px;object-fit:contain}h1{font-size:clamp(24px,5vw,32px);line-height:1.5}p{color:#a7b9ae;line-height:1.8}a{display:inline-block;margin-top:12px;min-height:48px;padding:12px 22px;border:1px solid #8fddb2;border-radius:12px;color:#b4edcc;text-decoration:none;font-weight:bold}a:focus-visible{outline:3px solid #8fddb2;outline-offset:4px}</style></head><body><main><img src="/assets/logo-emblem.webp" alt="KSA.MEN"><h1>${title}</h1><p>${message}</p><a href="https://${root}/">${home}</a></main></body></html>`;
}
