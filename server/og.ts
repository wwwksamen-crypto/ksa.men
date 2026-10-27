import type { App, Ctx } from './core';
import { one, publicProfile, digest } from './core';
import { HTTPException } from 'hono/http-exception';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import wasm from './vendor/resvg.wasm';

const escape=(text:string)=>text.replace(/[&<>"']/g,value=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[value]!));
let ready:Promise<void>|undefined;
const initialize=()=>ready||(ready=initWasm(wasm));
const b64=(bytes:Uint8Array)=>{let output='';for(let index=0;index<bytes.length;index+=4096)output+=String.fromCharCode(...bytes.slice(index,index+4096));return btoa(output);};
export function shareProfile(raw:any,lang:string){const original=typeof raw==='string'?JSON.parse(raw):raw;const translated=original?.translations?.[lang];return publicProfile(translated&&typeof translated==='object'?{...original,...translated,hidden:original.hidden}:original);}
export async function shareSite(c:Ctx,name:string){
 if(!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name))throw new HTTPException(404);
 const site:any=await one(c,"SELECT s.*,n.name,u.status AS owner_status FROM dns_names n JOIN sites s ON s.id=n.site_id LEFT JOIN users u ON u.id=COALESCE(s.user_id,n.owner_id) WHERE n.name=? AND s.status='published' AND s.published IS NOT NULL",name);
 if(!site||site.owner_status!=='active')throw new HTTPException(404);
 return site;
}
export function registerOG(app:App){
 app.get('/api/public/og/:name',async c=>{
  const site=await shareSite(c,c.req.param('name'));
  if(site.lock_hash)throw new HTTPException(423,{message:'الموقع خاص، ولا تتوفر له صورة مشاركة عامة'});
  const lang=c.req.query('lang')==='en'?'en':'ar';
  const profile=shareProfile(site.published,lang);
  const cacheKey='sharing/'+site.id+'/'+site.published_version+'-'+lang+'-'+await digest(JSON.stringify(profile))+'.png';
  const saved=await c.env.MEDIA.get(cacheKey);
  if(saved)return new Response(saved.body,{headers:{'Content-Type':'image/png','Cache-Control':'private, no-store'}});
  await initialize();
  const font=new Uint8Array(await(await c.env.ASSETS.fetch(new Request(new URL('/assets/Tajawal-Regular.ttf',c.req.url)))).arrayBuffer());
  const icon=new Uint8Array(await(await c.env.ASSETS.fetch(new Request(new URL('/assets/icon-192.png',c.req.url)))).arrayBuffer());
  const arabic=lang==='ar',anchor=arabic?'end':'start',x=arabic?1088:112;
  const name=String(profile.name||'KSA.MEN').slice(0,55),title=String(profile.title||'').slice(0,75),city=String(profile.city||'').slice(0,55);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><linearGradient id="background" x2="1" y2="1"><stop stop-color="#004422"/><stop offset="1" stop-color="#07120f"/></linearGradient></defs><rect width="1200" height="630" fill="url(#background)"/><rect x="32" y="32" width="1136" height="566" rx="30" fill="none" stroke="#41624e"/><circle cx="80" cy="590" r="235" fill="#006837" opacity=".28"/><image href="data:image/png;base64,${b64(icon)}" x="1010" y="55" width="105" height="105"/><text x="80" y="110" fill="#a8d9bc" font-family="Tajawal" font-size="30" letter-spacing="3">KSA.MEN</text><text x="${x}" y="278" fill="#f5f7f6" font-family="Tajawal" font-size="62" text-anchor="${anchor}" direction="${arabic?'rtl':'ltr'}">${escape(name)}</text><text x="${x}" y="354" fill="#8de0af" font-family="Tajawal" font-size="36" text-anchor="${anchor}" direction="${arabic?'rtl':'ltr'}">${escape(title)}</text><text x="${x}" y="410" fill="#c2cfc5" font-family="Tajawal" font-size="27" text-anchor="${anchor}" direction="${arabic?'rtl':'ltr'}">${escape(city)}</text><line x1="90" y1="478" x2="1110" y2="478" stroke="#345441"/><text x="600" y="545" fill="#e3eae5" font-family="Tajawal" font-size="30" text-anchor="middle">${escape(site.name+'.ksa.men')}</text></svg>`;
  const renderer=new Resvg(svg,{font:{fontBuffers:[font],defaultFontFamily:'Tajawal'},fitTo:{mode:'original'},textRendering:1});
  const image=renderer.render();const png=new Uint8Array(image.asPng());image.free();renderer.free();
  await c.env.MEDIA.put(cacheKey,png,{httpMetadata:{contentType:'image/png'},customMetadata:{siteId:site.id,publishedVersion:String(site.published_version),lang}});
  return new Response(png,{headers:{'Content-Type':'image/png','Cache-Control':'private, no-store'}});
 });
}
export async function personalizedHTML(c:Ctx,html:string){
 const url=new URL(c.req.url),root=c.env.ROOT_DOMAIN;
 if(url.hostname===root)return html;
 const name=url.hostname.slice(0,-root.length-1);
 const site=await shareSite(c,name);
 if(site.lock_hash)return html.replace(/<title>[\s\S]*?<\/title>/,'<title>KSA.MEN — موقع خاص</title>');
 const lang=url.searchParams.get('lang')==='en'?'en':'ar',profile=shareProfile(site.published,lang);
 const title=String(profile.name||'KSA.MEN')+(profile.title?' — '+String(profile.title):'');
 const description=String(profile.bio|| (lang==='ar'?'هوية مهنية سعودية — ظهور رقمي يليق بك':'A Saudi professional identity — a presence worthy of you')).slice(0,220);
 const canonical='https://'+name+'.'+root+'/';
 const image='https://'+root+'/api/public/og/'+name+'?lang='+lang;
 const metadata=`<meta name="description" content="${escape(description)}"><link rel="canonical" href="${canonical}"><meta property="og:type" content="profile"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${image}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">`;
 const crawler=`<section id="public-summary" aria-label="${lang==='ar'?'الهوية المهنية':'Professional identity'}"><h1>${escape(String(profile.name||'KSA.MEN'))}</h1>${profile.title?'<p>'+escape(String(profile.title))+'</p>':''}${profile.bio?'<p>'+escape(String(profile.bio))+'</p>':''}</section>`;
 return html.replace(/<title>[\s\S]*?<\/title>/,'<title>'+escape(title)+'</title>').replace(/<meta name="description"[^>]*>/,'').replace('</head>',metadata+'</head>').replace('<body>','<body>'+'<noscript>'+crawler+'</noscript>');
}
