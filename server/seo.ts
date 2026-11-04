import { managedText, managedBlocks } from '../shared/managed-text';
import type { App, Ctx } from './core';
import { all, one, setting } from './core';
import { HTTPException } from 'hono/http-exception';
import { siteVisibility } from './visibility';
import { shareSite } from './og';
import { readQuickLink } from './quick-links';
import { isQuickPath, quickMetadata } from '../shared/quick-link';
import { decorateHTML, htmlEscape as e, type Locale } from '../shared/seo';
const pages:Record<string,[string,string,string,string]>={
 '/':['ظهور رقمي يليق بك','A digital presence worthy of you','اسمك عنوانك. وخبرتك قصة تستحق أن تُرى.','Your name is your address. Your expertise deserves to be seen.'],
 '/features':['كل ما تحتاجه لظهور يليق بك','Everything for a presence worthy of you','هوية رقمية مستقلة. أدوات مشاركة عملية. تحكم واضح في بياناتك.','An independent identity. Practical sharing tools. Clear control of your data.'],
 '/about':['نؤمن بالإنسان. ونمنح أثره مساحة.','We believe in people. And give their impact a place.','وراء كل خبرة رحلة. وراء كل مهارة وقت وجهد وطموح.','Behind every skill is a journey of effort, time and ambition.'],
 '/contact':['يسعدنا أن نسمعك','We would love to hear from you','كل رحلة تبدأ بتواصل صادق. نحن هنا لمساعدتك.','Every journey begins with an honest conversation. We are here to help.'],
 '/blog':['مدونة الظهور الرقمي','The Digital Presence Journal','الظهور الرقمي المميز يبدأ بقصة دقيقة وهوية واضحة.','Distinctive digital presence begins with a precise story and a clear identity.'],
 '/privacy':['سياسة الخصوصية','Privacy policy','نوضح ما نعالجه، ولماذا، وخياراتك عند استخدام المنصة.','We explain what we process, why, and your choices when using the platform.'],
 '/terms':['شروط الاستخدام','Terms of use','شروط واضحة لخدمة حضور وهوية مهنية شخصية على نطاق فرعي.','Clear terms for a personal professional presence and identity service on a subdomain.'],
 '/qr':['شارك حضورك بلمسة','One scan. Your whole story.','رمز استجابة سريعة وبطاقة اتصال. هدية من المنصة، دون تسجيل.','QR and contact cards. A gift from us. No account needed.']
};
export function knownRootPage(path:string){return path in pages||['/auth','/admin','/dashboard','/search','/radar'].includes(path)||(/^\/export\/[^/]+$/.test(path)||isQuickPath(path));}
export async function rootHTML(c:Ctx,html:string,open:boolean){
 const url=new URL(c.req.url),path=url.pathname==='/index.html'?'/':url.pathname;
 const lang:Locale=url.searchParams.get('lang')==='en'?'en':'ar',english=lang==='en';
 const base=pages[path],privateRoute=!base||url.searchParams.has('recipient');
 const indexable=open&&!privateRoute;
 if(!indexable)c.header('X-Robots-Tag','noindex, nofollow');
 if(!base)return decorateHTML(html,{title:'KSA.MEN — '+(english?'Your space':'مساحتك'),description:english?'Your personal space on KSA.MEN.':'مساحتك الخاصة في KSA.MEN.',lang,indexable:false});
 const slug=path==='/'?'home':path.slice(1);
 const content=path==='/qr'?null:await one<Record<string,unknown>>(c,"SELECT title_ar,title_en,body_ar,body_en FROM content WHERE slug=? AND status='published'",slug);
 const title=String(content?.['title_'+lang]||base[english?1:0]);
 const body=managedText(content?.['body_'+lang]||base[english?3:2]);
 const canonical='https://'+c.env.ROOT_DOMAIN+path+(english?'?lang=en':'');
 const root='https://'+c.env.ROOT_DOMAIN;
 const paragraphs=managedBlocks(body).map(block=>block.kind==='heading'?`<h2>${e(block.text)}</h2>`:`<p>${e(block.text)}</p>`).join('');
 const rendered=privateRoute||!indexable?'':`<header><a href="${root}/">KSA.MEN</a><h1>${e(title)}</h1></header>${paragraphs}<nav aria-label="${english?'Explore KSA.MEN':'اكتشف KSA.MEN'}"><a href="${root}/features">${english?'Features':'المزايا'}</a><a href="${root}/about">${english?'Our story':'قصتنا'}</a><a href="${root}/contact">${english?'Contact':'تواصل معنا'}</a><a href="${root}/auth?register=1">${english?'Create your site':'أنشئ موقعك'}</a></nav>`;
 return decorateHTML(html,{title:`${title} — KSA.MEN`,description:body,lang,indexable,url:privateRoute?undefined:canonical,image:root+'/assets/share-logo-1200-v1.png',alternate:root+path+(english?'':'?lang=en'),schema:indexable?{'@context':'https://schema.org','@type':path==='/'?'WebSite':'WebPage',name:title,url:canonical,description:body.slice(0,160),inLanguage:lang}:undefined},rendered);
}
const xmlHeader='<?xml version="1.0" encoding="UTF-8"?>';
const urlset=(urls:string[])=>xmlHeader+'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+urls.map(url=>`<url><loc>${e(url)}</loc></url>`).join('')+'</urlset>';
const eligible=`FROM sites s JOIN dns_names n ON n.site_id=s.id JOIN users u ON u.id=COALESCE(s.user_id,n.owner_id) LEFT JOIN site_visibility v ON v.site_id=s.id WHERE s.status='published' AND s.published IS NOT NULL AND u.status='active' AND COALESCE(s.lock_hash,'')='' AND COALESCE(v.visible,1)=1 AND COALESCE(v.indexable,1)=1`;
const PAGE_SIZE=1000;
async function publiclyIndexable(c:Ctx){return c.get('platformLockMode')==='open';}
export function registerSEO(app:App){
 const quickDocument = async (c:Ctx) => {
  if(new URL(c.req.url).hostname!==c.env.ROOT_DOMAIN)throw new HTTPException(404);
  c.header('X-Robots-Tag','noindex, nofollow');
  const asset=await c.env.ASSETS.fetch(new Request(new URL('/index.html',c.req.url),c.req.raw));
  const html=await asset.text();
  if(c.get('platformLockMode')!=='open')return c.html(await rootHTML(c,html,false));
  let available=true;
  try{await readQuickLink(c,c.req.param('id')||'');}catch(error){if(!(error instanceof HTTPException)||error.status!==404)throw error;available=false;}
  const lang=c.req.query('lang')==='en'?'en':'ar';
  const page=quickMetadata(new URL(c.req.url).pathname,lang,c.env.ROOT_DOMAIN,available);
  const body=`<header><img src="/assets/logo-emblem.webp" alt="KSA.MEN" width="120" height="120"><h1>${e(page.title)}</h1></header><p>${e(page.description)}</p>`;
  return c.html(decorateHTML(html,page,body),available?200:404);
 };
 app.get('/q/:id',quickDocument);
 app.get('/quick/:id',quickDocument);
 app.get('/robots.txt',async c=>{
  if(!await publiclyIndexable(c))return c.text('User-agent: *\nDisallow: /\n');
  const host=new URL(c.req.url).hostname,root=c.env.ROOT_DOMAIN;
  if(host!==root){try{const site=await shareSite(c,host.slice(0,-root.length-1));const policy=await siteVisibility(c,site);if(site.lock_hash||!policy.indexable)return c.text('User-agent: *\nDisallow: /\n');}catch{return c.text('User-agent: *\nDisallow: /\n');}}
  return c.text('User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /dashboard\nDisallow: /auth\nDisallow: /api/\nDisallow: /export/\nDisallow: /quick/\nDisallow: /q/\nDisallow: /radar\nDisallow: /search\nSitemap: https://'+host+'/sitemap.xml\n');
 });
 app.get('/sitemap.xml',async c=>{
  if(!await publiclyIndexable(c))return c.body(urlset([]),200,{'Content-Type':'application/xml; charset=utf-8'});
  const root=c.env.ROOT_DOMAIN,host=new URL(c.req.url).hostname;
  if(host!==root){try{const site=await shareSite(c,host.slice(0,-root.length-1));const policy=await siteVisibility(c,site);if(site.lock_hash||!policy.indexable)return c.body(urlset([]),200,{'Content-Type':'application/xml; charset=utf-8'});return c.body(urlset(['https://'+host+'/']),200,{'Content-Type':'application/xml; charset=utf-8'});}catch{return c.body(urlset([]),200,{'Content-Type':'application/xml; charset=utf-8'});}}
  const count=await one<{n:number}>(c,'SELECT COUNT(*) n '+eligible);
  const links=['https://'+root+'/sitemap-pages.xml',...Array.from({length:Math.ceil(Number(count?.n||0)/PAGE_SIZE)},(_,i)=>'https://'+root+'/sitemap-profiles/'+(i+1)+'.xml')];
  return c.body(xmlHeader+'<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+links.map(url=>`<sitemap><loc>${e(url)}</loc></sitemap>`).join('')+'</sitemapindex>',200,{'Content-Type':'application/xml; charset=utf-8'});
 });
 app.get('/sitemap-pages.xml',async c=>{
  if(new URL(c.req.url).hostname!==c.env.ROOT_DOMAIN)throw new HTTPException(404);
  return c.body(urlset(await publiclyIndexable(c)?Object.keys(pages).flatMap(path=>['https://'+c.env.ROOT_DOMAIN+path,'https://'+c.env.ROOT_DOMAIN+path+'?lang=en']):[]),200,{'Content-Type':'application/xml; charset=utf-8'});
 });
 app.get('/sitemap-profiles/:file',async c=>{
  if(new URL(c.req.url).hostname!==c.env.ROOT_DOMAIN)throw new HTTPException(404);
  const file=c.req.param('file');if(!/^[1-9][0-9]*\.xml$/.test(file))throw new HTTPException(404);const page=Number(file.slice(0,-4));if(!Number.isInteger(page)||page<1||page>50000)throw new HTTPException(404);
  const rows=await publiclyIndexable(c)?await all<{name:string}>(c,'SELECT n.name '+eligible+' ORDER BY n.name LIMIT ? OFFSET ?',PAGE_SIZE,(page-1)*PAGE_SIZE):[];
  // Each subdomain also declares its own same-origin sitemap; no private content or draft is read here.
  return c.body(urlset(rows.map(row=>'https://'+row.name+'.'+c.env.ROOT_DOMAIN+'/')),200,{'Content-Type':'application/xml; charset=utf-8'});
 });
}
