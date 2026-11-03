import { metadata, personSchema, type PageSEO, type Locale } from '../../shared/seo';
const defaults:Record<string,[string,string,string,string]>={
 '/':['ظهور رقمي يليق بك','A digital presence worthy of you','اسمك عنوانك. وخبرتك قصة تستحق أن تُرى.','Your name is your address. Your expertise deserves to be seen.'],
 '/features':['كل ما تحتاجه لظهور يليق بك','Everything for a presence worthy of you','هوية رقمية مستقلة. أدوات مشاركة عملية. تحكم واضح في بياناتك.','An independent identity. Practical sharing tools. Clear control of your data.'],
 '/about':['نؤمن بالإنسان. ونمنح أثره مساحة.','We believe in people. And give their impact a place.','وراء كل خبرة رحلة. وراء كل مهارة وقت وجهد وطموح.','Behind every skill is a journey of effort, time and ambition.'],
 '/contact':['يسعدنا أن نسمعك','We would love to hear from you','كل رحلة تبدأ بتواصل صادق. نحن هنا لمساعدتك.','Every journey begins with an honest conversation. We are here to help.'],
 '/blog':['مدونة الظهور الرقمي','The Digital Presence Journal','الظهور الرقمي المميز يبدأ بقصة دقيقة وهوية واضحة.','Distinctive digital presence begins with a precise story and a clear identity.'],
 '/privacy':['سياسة الخصوصية','Privacy policy','نوضح ما نعالجه، ولماذا، وخياراتك عند استخدام المنصة.','We explain what we process, why, and your choices when using the platform.'],
 '/terms':['شروط الاستخدام','Terms of use','شروط واضحة لخدمة حضور وهوية مهنية شخصية على نطاق فرعي.','Clear terms for a personal professional presence and identity service on a subdomain.'],
 '/qr':['شارك حضورك بلمسة','One scan. Your whole story.','QR وبطاقة اتصال. هدية من المنصة، دون تسجيل.','QR and contact cards. A gift from us. No account needed.']
};
function apply(page:PageSEO){
 const head=document.head;
 head.querySelectorAll('title,meta[name="description"],meta[name="robots"],meta[property^="og:"],meta[name^="twitter:"],link[rel="canonical"],link[rel="alternate"][hreflang],script[type="application/ld+json"]').forEach(n=>n.remove());
 const template=document.createElement('template');template.innerHTML=metadata(page);head.appendChild(template.content);
}
export function updateClientMetadata(path:string,lang:Locale,content?:Record<string,unknown>|null){
 const base=defaults[path],root='https://ksa.men';
 const indexable=!!base&&!new URLSearchParams(location.search).has('recipient')&&document.querySelector('meta[name="robots"]')?.getAttribute('content')?.includes('noindex')!==true;
 if(!base){apply({title:'KSA.MEN — '+(lang==='ar'?'مساحتك':'Your space'),description:lang==='ar'?'مساحتك الخاصة في KSA.MEN.':'Your personal space on KSA.MEN.',lang,indexable:false});return;}
 // Preserve managed copy supplied in the original response until its matching locale arrives.
 const currentLang=document.querySelector('meta[property="og:locale"]')?.getAttribute('content');
 if(!content&&currentLang===(lang==='ar'?'ar_SA':'en_US'))return;
 const title=String(content?.['title_'+lang]||base[lang==='ar'?0:1]),description=String(content?.['body_'+lang]||base[lang==='ar'?2:3]);
 const url=root+path+(lang==='en'?'?lang=en':'');
 apply({title:title+' — KSA.MEN',description,url,lang,indexable,image:root+'/assets/cover-1600.webp',alternate:root+path+(lang==='en'?'':'?lang=en'),schema:indexable?{'@context':'https://schema.org','@type':path==='/'?'WebSite':'WebPage',name:title,url,description:description.slice(0,160),inLanguage:lang}:undefined});
}
export function updateProfileMetadata(profile:Record<string,unknown>,name:string,lang:Locale,indexable:boolean){
 const url=`https://${name}.ksa.men/`+(lang==='en'?'?lang=en':'');
 const title=String(profile.name||name)+(profile.title?' — '+profile.title:'');
 apply({title,description:String(profile.bio||(lang==='ar'?'هوية مهنية سعودية — ظهور رقمي يليق بك':'A Saudi professional identity — a presence worthy of you')),url,lang,indexable,type:'profile',image:'https://ksa.men/api/public/og/'+encodeURIComponent(name)+'?lang='+lang,alternate:`https://${name}.ksa.men/`+(lang==='en'?'':'?lang=en'),schema:indexable?personSchema(profile,url):undefined});
}
export function clearProfileMetadata(lang:Locale){apply({title:lang==='ar'?'KSA.MEN — هوية غير متاحة':'KSA.MEN — Identity unavailable',description:'KSA.MEN',lang,indexable:false});}
