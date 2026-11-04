import { sanitizeProfile } from './profile-visibility';
import { itemText, list, mediaSource, socialLink, youtubeLink } from './profile-content';
export type Locale = 'ar' | 'en';
export const htmlEscape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const jsonScript = (value: unknown) => JSON.stringify(value).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
export type PageSEO = { title: string; description: string; url?: string; image?: string; lang: Locale; indexable: boolean; type?: string; schema?: unknown; alternate?: string };
export function metadata(page: PageSEO) {
 const e=htmlEscape;
 return `<title>${e(page.title)}</title><meta name="description" content="${e(page.description.slice(0,160))}"><meta name="robots" content="${page.indexable?'index,follow,max-image-preview:large':'noindex,nofollow'}">${page.url?`<link rel="canonical" href="${e(page.url)}"><meta property="og:url" content="${e(page.url)}">`:''}<meta property="og:type" content="${e(page.type||'website')}"><meta property="og:site_name" content="KSA.MEN"><meta property="og:locale" content="${page.lang==='ar'?'ar_SA':'en_US'}"><meta property="og:title" content="${e(page.title)}"><meta property="og:description" content="${e(page.description.slice(0,160))}"><meta name="twitter:card" content="${page.image?'summary_large_image':'summary'}"><meta name="twitter:title" content="${e(page.title)}"><meta name="twitter:description" content="${e(page.description.slice(0,160))}">${page.image?`<meta property="og:image" content="${e(page.image)}"><meta property="og:image:secure_url" content="${e(page.image)}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${e(page.title)}"><meta name="twitter:image" content="${e(page.image)}"><meta name="twitter:image:alt" content="${e(page.title)}">`:''}${page.alternate&&page.url?`<link rel="alternate" hreflang="${page.lang}" href="${e(page.url)}"><link rel="alternate" hreflang="${page.lang==='ar'?'en':'ar'}" href="${e(page.alternate)}">`:''}${page.schema?`<script type="application/ld+json">${jsonScript(page.schema)}</script>`:''}`;
}
export function decorateHTML(html: string, page: PageSEO, body = '') {
 const clean=html.replace(/<title>[\s\S]*?<\/title>/gi,'').replace(/<meta\s+(?:name=["'](?:description|robots|twitter:[^"']+)["']|property=["']og:[^"']+["'])[^>]*>/gi,'').replace(/<link\s+rel=["'](?:canonical|alternate)["'][^>]*>/gi,'');
 const content=body?`<main id="initial-content" class="initial-content" lang="${page.lang}" dir="${page.lang==='ar'?'rtl':'ltr'}">${body}</main>`:'';
 return clean.replace(/<html\b[^>]*>/i,`<html lang="${page.lang}" dir="${page.lang==='ar'?'rtl':'ltr'}">`).replace('</head>',metadata(page)+'</head>').replace(/<body([^>]*)>/i,`<body$1>${content}`);
}
export function profileBody(profile: Record<string, unknown>, name: string, lang: Locale) {
 profile=sanitizeProfile(profile);
 const e=htmlEscape,t=(ar:string,en:string)=>lang==='ar'?ar:en;
 const para=(v:unknown)=>typeof v==='string'&&v.trim()?`<p>${e(v)}</p>`:'';
 const country = typeof profile.country === 'string' && /^(?:Saudi Arabia|Kingdom of Saudi Arabia|KSA|السعودية|المملكة العربية السعودية)$/i.test(profile.country.trim()) ? t('المملكة العربية السعودية', 'Saudi Arabia') : profile.country;
 let body=`<header><a href="https://ksa.men/">KSA.MEN</a><h1>${e(profile.name||name)}</h1>${para(profile.title)}${para(profile.specialty)}${para([profile.city,country].filter(Boolean).join(lang==='ar'?'، ':', '))}</header>`;
 const labels:Record<string,[string,string]>={bio:['في سطور','In brief'],experience:['الخبرات العملية','Experience'],education:['المؤهلات التعليمية','Education'],training:['التدريب والتطوير','Training'],timeline:['سجل الإنجازات','Milestones'],skills:['المهارات','Skills'],achievements:['الإنجازات','Achievements'],memberships:['العضويات المهنية','Memberships'],languages:['اللغات','Languages'],hobbies:['الاهتمامات','Interests'],blog:['المدونة الشخصية','Personal journal']};
 for(const [key,label]of Object.entries(labels)){
  const value=profile[key];
  const rows=list(value).map(row=>{if(typeof row==='string')return `<li>${e(row)}</li>`;if(!row||typeof row!=='object')return '';const p=row as Record<string,unknown>;return `<li>${para([p.start||p.date,p.end].filter(Boolean).join(' — '))}${para(p.title||p.name||p.role||p.label)}${para(p.organization||p.institution)}${para(p.description||p.level)}</li>`;}).join('');
  const content=typeof value==='string'?para(value):rows?`<ul>${rows}</ul>`:'';
  if(content)body+=`<section><h2>${e(t(...label))}</h2>${content}</section>`;
 }
 if(profile.skillRadar&&typeof profile.skillRadar==='object')for(const [key,label]of Object.entries({human:t('مهارات إنسانية','Human skills'),scientific:t('مهارات علمية','Scientific skills'),professional:t('مهارات مهنية','Professional skills')})){
  const values=list((profile.skillRadar as Record<string,unknown>)[key]).map(itemText).filter(Boolean);if(values.length)body+=`<section><h2>${e(label)}</h2><ul>${values.map(v=>`<li>${e(v)}</li>`).join('')}</ul></section>`;
 }
 for(const [key,label]of [['skillImages',t('توثيق المهارات','Skill evidence')],['workImages',t('نماذج الأعمال','Selected work')]]){
  const descriptions=profile.imageDescriptions as Record<string,unknown>|undefined;
  const images=list(profile[key]).map(mediaSource).filter(Boolean);if(images.length)body+=`<section><h2>${e(label)}</h2>${images.map((src,i)=>`<img src="${e(src)}" alt="${e(descriptions?.[src]||`${label} ${i+1}`)}" width="320" height="240" loading="lazy" decoding="async">`).join('')}</section>`;
 }
 const youtube=youtubeLink(profile.youtube);
 const links=[...list(profile.socials),...list(profile.buttons),...(youtube?[{url:youtube.url}]:[])].map(socialLink).filter(Boolean);
 if(links.length)body+=`<nav aria-label="${t('روابط مختارة','Selected links')}">${links.map(v=>`<a href="${e(v!.url)}" rel="noopener noreferrer">${e(v!.label)}</a>`).join(' ')}</nav>`;
 if(typeof profile.email==='string'&&profile.email)body+=`<p><a href="mailto:${e(profile.email)}">${e(profile.email)}</a></p>`;
 if(typeof profile.phone==='string'&&profile.phone)body+=`<p><a href="tel:${e(profile.phone)}">${e(profile.phone)}</a></p>`;
 return body;
}
export function personSchema(profile:Record<string,unknown>,url:string){
 profile=sanitizeProfile(profile);
 const links=list(profile.socials).map(socialLink).filter(Boolean).map(link=>link!.url);
 const expertise=[typeof profile.specialty==='string'?profile.specialty:'',...list(profile.skills).map(itemText)].filter(Boolean);
 return {'@context':'https://schema.org','@type':'ProfilePage',url,mainEntity:{'@type':'Person',...(profile.name?{name:profile.name}:{}),...(profile.title?{jobTitle:profile.title}:{}),...(profile.bio?{description:profile.bio}:{}),...(links.length?{sameAs:links}:{}),...(expertise.length?{knowsAbout:expertise}:{}),...(profile.city?{address:{'@type':'PostalAddress',addressLocality:profile.city,...(profile.country?{addressCountry:profile.country}:{})}}:{})}};
}
