import { record, socialLink, type SocialBrand } from './profile-content';
export const socialPlatforms = [
  { key:'linkedin', ar:'لينكدإن', url:'https://www.linkedin.com/' },
  { key:'facebook', ar:'فيسبوك', url:'https://www.facebook.com/' },
  { key:'instagram', ar:'إنستجرام', url:'https://www.instagram.com/' },
  { key:'snapchat', ar:'سناب شات', url:'https://www.snapchat.com/' },
  { key:'tiktok', ar:'تيك توك', url:'https://www.tiktok.com/' },
  { key:'x', ar:'إكس', url:'https://x.com/' },
  { key:'youtube', ar:'يوتيوب', url:'https://www.youtube.com/' },
  { key:'telegram', ar:'تلجرام', url:'https://telegram.org/' },
] as const;
export type SocialKey = typeof socialPlatforms[number]['key'];
export type SocialOverrides = Partial<Record<SocialKey,string>>;
function matchingUrl(value:unknown,key:SocialKey):string {
 const link=socialLink(value);
 // telegram.org is the company's actual home, not an account handle.
 return link && new URL(link.url).protocol==='https:' && (link.brand===key || key==='telegram' && new URL(link.url).hostname==='telegram.org') ? link.url : '';
}
/** Public projection ignores unknown or unsafe stored fields; edit validation is strict. */
export function socialOverrides(value:unknown):SocialOverrides {
 const raw=record(value);return Object.fromEntries(socialPlatforms.flatMap(({key})=>{const url=matchingUrl(raw[key],key);return url?[[key,url]]:[];}));
}
export function validateSocialOverrides(value:unknown):SocialOverrides {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('أدخل روابط التواصل كحقول صحيحة.');
 const raw=record(value);
 if(Object.keys(raw).some(key=>!socialPlatforms.some(platform=>platform.key===key)))throw new Error('منصة التواصل غير مدعومة.');
 for(const {key,ar} of socialPlatforms)if(raw[key]!==undefined&&raw[key]!==''&&(typeof raw[key]!=='string'||!matchingUrl(raw[key],key)))throw new Error(`أدخل رابط HTTPS صحيحاً لمنصة ${ar}.`);
 return socialOverrides(raw);
}
export function orderedSocialLinks(value:unknown[]|SocialOverrides=[]) {
 const input=Array.isArray(value)?value:Object.entries(value).map(([key,url])=>({url,platform:key}));
 const links=input.map(socialLink).filter((link):link is NonNullable<ReturnType<typeof socialLink>>=>Boolean(link));
 return socialPlatforms.map(platform=>{
  const link=links.find(link=>link.brand===platform.key);
  const explicit=!Array.isArray(value)?matchingUrl(value[platform.key],platform.key):'';
  return {...platform,url:explicit||link?.url||platform.url,brand:platform.key as SocialBrand,isDefault:!explicit&&!link};
 });
}
