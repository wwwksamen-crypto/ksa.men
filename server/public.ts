import type {App,Ctx} from './core';
import {one,all,run,now,uid,me,siteFor,service,publicProfile,rate,verifySecret,hmac} from './core';
import {HTTPException} from 'hono/http-exception';
import {getCookie,setCookie} from 'hono/cookie';
import {z} from 'zod';

type ExportRule={canonical:string;serviceKey:string|null};

const exportRules:Record<string,ExportRule>={
  profile:{canonical:'profile',serviceKey:'profile_pdf'},
  pdf:{canonical:'profile',serviceKey:'profile_pdf'},
  professional:{canonical:'profile',serviceKey:'profile_pdf'},
  identity:{canonical:'profile',serviceKey:'profile_pdf'},
  ats:{canonical:'ats',serviceKey:'ats_pdf'},
  resume:{canonical:'ats',serviceKey:'ats_pdf'},
  cv:{canonical:'ats',serviceKey:'ats_pdf'},
  badge:{canonical:'badge',serviceKey:'digital_card'},
  conference:{canonical:'badge',serviceKey:'digital_card'},
  card:{canonical:'card',serviceKey:'digital_card'},
  digital_card:{canonical:'card',serviceKey:'digital_card'},
  'digital-card':{canonical:'card',serviceKey:'digital_card'},
  social:{canonical:'social',serviceKey:'digital_card'},
  share:{canonical:'social',serviceKey:'digital_card'},
  vcard:{canonical:'vcard',serviceKey:'vcard'},
  vcf:{canonical:'vcard',serviceKey:'vcard'},
  contact:{canonical:'vcard',serviceKey:'vcard'},
  qr:{canonical:'qr',serviceKey:null},
  qrcode:{canonical:'qr',serviceKey:null},
  free_qr:{canonical:'qr',serviceKey:null},
};

function publishedJson(site:{published:string}){
  try{return JSON.parse(site.published) as Record<string,unknown>;}catch{throw new HTTPException(500,{message:'تعذر قراءة النسخة المنشورة بأمان'});}
}

function visibility(raw:Record<string,unknown>){
  return Array.isArray(raw.hidden)?raw.hidden.filter((field):field is string=>typeof field==='string'):[];
}

const publicExportName=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Applies the published locale first, then removes every field that its owner hid. */
export function visibleProfile(raw:Record<string,unknown>,lang:string,includeVisibility=false){
  const translation=lang==='en'&&raw.translations&&typeof raw.translations==='object'
    ?(raw.translations as Record<string,unknown>).en
    :undefined;
  const localized=translation&&typeof translation==='object'
    ?{...raw,...translation,hidden:visibility(raw)}
    :{...raw,hidden:visibility(raw)};
  const profile=publicProfile(localized) as Record<string,unknown>;
  return includeVisibility?{...profile,hidden:visibility(raw)}:profile;
}

function exportRule(kind:string){
  const normalized=kind.trim().toLowerCase();
  const rule=exportRules[normalized];
  if(!rule)throw new HTTPException(400,{message:'نوع التصدير غير مدعوم'});
  return rule;
}

function profileReferencesMedia(profile:Record<string,unknown>,mediaId:string){
  const expected='/api/media/'+mediaId;
  const media=[profile.photo,profile.cover,...(Array.isArray(profile.skillImages)?profile.skillImages:[]),...(Array.isArray(profile.workImages)?profile.workImages:[])];
  return media.some(value=>value===expected);
}

function publishedReferencesMedia(raw:Record<string,unknown>,mediaId:string){
  return profileReferencesMedia(visibleProfile(raw,'ar'),mediaId)||profileReferencesMedia(visibleProfile(raw,'en'),mediaId);
}

export async function personalGate(c:Ctx,site:any){
  if(!site.lock_hash)return true;
  const raw=getCookie(c,'__Host-ksa_site')||'';
  const [time,sig]=raw.split('.');
  return Number(time)>now()&&sig===await hmac(c.env.AUTH_SECRET,site.id+':'+time+':'+site.lock_hash);
}

export async function publishedForHost(c:Ctx){
  const host=new URL(c.req.url).hostname;
  const name=host.replace('.'+c.env.ROOT_DOMAIN,'');
  if(host===c.env.ROOT_DOMAIN)throw new HTTPException(404);
  const site:any=await one(c,"SELECT s.*,n.name FROM dns_names n JOIN sites s ON s.id=n.site_id JOIN users u ON u.id=COALESCE(s.user_id,n.owner_id) WHERE n.name=? AND s.status='published' AND s.published IS NOT NULL AND u.status='active'",name);
  if(!site)throw new HTTPException(404,{message:'هذا الموقع غير منشور'});
  return site;
}

export function registerPublic(app:App){
  app.get('/api/public/profile',async c=>{
    const site=await publishedForHost(c);
    const raw=publishedJson(site);
    const lang=c.req.query('lang')==='en'?'en':'ar';
    const profile=visibleProfile(raw,lang);
    if(!await personalGate(c,site)){
      return c.json({locked:true,site:site.id,name:site.name,photo:typeof profile.photo==='string'?profile.photo:'/assets/logo.webp',message:site.lock_message});
    }
    return c.json({profile,site:site.id,name:site.name,branding:!!site.branding,userId:site.user_id?'C'+site.user_id:null});
  });

  app.post('/api/public/unlock',async c=>{
    const site=await publishedForHost(c);
    await rate(c,'site-lock:'+site.id+':'+c.req.header('CF-Connecting-IP'),6,900);
    const {password}=z.object({password:z.string().min(1).max(200)}).parse(await c.req.json());
    if(!site.lock_hash||!await verifySecret(password,site.lock_hash))throw new HTTPException(403,{message:'كلمة المرور غير صحيحة'});
    const expiresAt=now()+3600;
    setCookie(c,'__Host-ksa_site',expiresAt+'.'+await hmac(c.env.AUTH_SECRET,site.id+':'+expiresAt+':'+site.lock_hash),{httpOnly:true,secure:true,path:'/',sameSite:'Lax',maxAge:3600});
    return c.json({ok:true});
  });

  app.get('/api/search',async c=>{
    const query=(c.req.query('q')||'').slice(0,100).toLocaleLowerCase();
    const city=(c.req.query('city')||'').slice(0,100).toLocaleLowerCase();
    const specialty=(c.req.query('specialty')||'').slice(0,100).toLocaleLowerCase();
    const offset=Math.min(10_000,Math.max(0,Number(c.req.query('offset'))||0));
    const rows:any[]=await all(c,"SELECT s.id,s.user_id,s.published,s.lock_hash,n.name FROM sites s JOIN dns_names n ON n.site_id=s.id JOIN users u ON u.id=COALESCE(s.user_id,n.owner_id) WHERE u.status='active' AND s.status='published' AND s.searchable=1 AND s.published IS NOT NULL ORDER BY s.updated_at DESC LIMIT 200");
    const profiles=rows.filter(row=>!row.lock_hash).map(row=>({site:row.id,name:row.name,userId:row.user_id?'C'+row.user_id:null,profile:visibleProfile(publishedJson(row),'ar')}));
    const matched=profiles.filter(result=>{
      const profile=result.profile;
      const haystack=[result.name,result.userId,profile.name,profile.title,profile.city].filter(value=>typeof value==='string').join(' ').toLocaleLowerCase();
      const resultCity=typeof profile.city==='string'?profile.city.toLocaleLowerCase():'';
      const resultSpecialty=typeof profile.title==='string'?profile.title.toLocaleLowerCase():'';
      return haystack.includes(query)&&(!city||resultCity===city)&&(!specialty||resultSpecialty===specialty);
    });
    return c.json({
      items:matched.slice(offset,offset+20).map(result=>({
        site:result.site,
        name:result.name,
        userId:result.userId,
        profile:{name:result.profile.name,title:result.profile.title,city:result.profile.city,photo:result.profile.photo,allowContact:result.profile.allowContact},
        url:'https://'+result.name+'.'+c.env.ROOT_DOMAIN,
      })),
      total:matched.length,
      cities:[...new Set(profiles.map(result=>result.profile.city).filter((value):value is string=>typeof value==='string'&&Boolean(value)))],
      specialties:[...new Set(profiles.map(result=>result.profile.title).filter((value):value is string=>typeof value==='string'&&Boolean(value)))],
    });
  });

  app.get('/api/public/quick/:id',async c=>{
    const link:any=await one(c,'SELECT * FROM quick_links WHERE id=? AND revoked=0 AND expires_at>?',c.req.param('id'),now());
    if(!link)throw new HTTPException(404,{message:'انتهت صلاحية رابط التعارف أو ألغي'});
    const payload=JSON.parse(link.payload);
    const profile=payload.values||payload;
    return c.json({profile:{...profile,url:profile.url||profile.site},mode:payload.mode||'professional',expiresAt:link.expires_at});
  });

  // A visitor can receive only the approved published snapshot, never an editable draft.
  app.get('/api/public/export-data/:name',async c=>{
    const host=new URL(c.req.url).hostname;
    const name=c.req.param('name').trim().toLowerCase();
    if(host!==c.env.ROOT_DOMAIN||!publicExportName.test(name))throw new HTTPException(404,{message:'المخرج العام غير متاح'});
    const site:any=await one(c,"SELECT s.*,n.name FROM dns_names n JOIN sites s ON s.id=n.site_id JOIN users u ON u.id=COALESCE(s.user_id,n.owner_id) WHERE n.name=? AND s.status='published' AND s.published IS NOT NULL AND s.lock_hash IS NULL AND u.status='active'",name);
    if(!site)throw new HTTPException(404,{message:'المخرج العام غير متاح'});
    const rule=exportRule(c.req.query('kind')||'profile');
    const lang=c.req.query('lang')==='en'?'en':'ar';
    const raw=publishedJson(site);
    const hasTranslation=!!(raw.translations&&typeof raw.translations==='object'&&(raw.translations as Record<string,unknown>).en);
    return c.json({profile:visibleProfile(raw,lang,true),name:site.name,site:site.id,kind:rule.canonical,allowed:true,translated:lang!=='en'||hasTranslation,source:'published'});
  });

  // Owners and authorised delegates may preview their own editable draft only on the authenticated route.
  app.get('/api/export-data/:site',async c=>{
    const site=await siteFor(c,c.req.param('site'));
    const rule=exportRule(c.req.query('kind')||'profile');
    if(rule.serviceKey)await service(c,rule.serviceKey,site.user_id);
    let raw:Record<string,unknown>;
    try{raw=JSON.parse(site.draft) as Record<string,unknown>;}catch{throw new HTTPException(500,{message:'تعذر قراءة المسودة للتصدير بأمان'});}
    const lang=c.req.query('lang')==='en'?'en':'ar';
    const hasTranslation=!!(raw.translations&&typeof raw.translations==='object'&&(raw.translations as Record<string,unknown>).en);
    const name:any=await one(c,'SELECT name FROM dns_names WHERE site_id=? LIMIT 1',site.id);
    return c.json({profile:visibleProfile(raw,lang,true),name:name?.name??'',site:site.id,kind:rule.canonical,allowed:true,translated:lang!=='en'||hasTranslation,source:'draft'});
  });

  app.post('/api/upload',async c=>{
    const user=me(c);
    await rate(c,'upload:'+user.id,60,3600);
    const form=await c.req.formData();
    const file=form.get('file');
    if(!(file instanceof File))throw new HTTPException(400,{message:'اختر الملف'});
    const purpose=z.enum(['photo','cover','skill','work','receipt']).parse(form.get('purpose'));
    const siteId=String(form.get('siteId')||'');
    if(siteId)await siteFor(c,siteId);
    if(file.size<12)throw new HTTPException(400,{message:'اختر ملفاً كاملاً للرفع'});
    if(purpose==='receipt'&&file.size>8*1024*1024)throw new HTTPException(400,{message:'حجم الإيصال يتجاوز الحد المسموح'});
    const bytes=new Uint8Array(await file.arrayBuffer());
    let mime='';
    if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)mime='image/jpeg';
    if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)mime='image/png';
    if(new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP')mime='image/webp';
    if(purpose==='receipt'&&new TextDecoder().decode(bytes.slice(0,5))==='%PDF-')mime='application/pdf';
    if(!mime||file.type!==mime)throw new HTTPException(400,{message:'تعذر التحقق من محتوى الملف'});
    if(purpose!=='receipt'&&mime!=='image/webp')throw new HTTPException(400,{message:'تُجهز صور الهوية بصيغة WebP قبل الرفع'});
    const id=uid(),key='user/'+user.id+'/'+id;
    await c.env.MEDIA.put(key,bytes,{httpMetadata:{contentType:mime}});
    await run(c,'INSERT INTO media(id,owner_id,site_id,purpose,bucket_key,mime,size,created_at) VALUES(?,?,?,?,?,?,?,?)',id,user.id,siteId||null,purpose,key,mime,file.size,now());
    return c.json({id,url:'/api/media/'+id});
  });

  app.get('/api/media/:id',async c=>{
    const media:any=await one(c,'SELECT * FROM media WHERE id=?',c.req.param('id'));
    if(!media)throw new HTTPException(404);
    const user=c.get('user');
    let authorized=user?.id===media.owner_id;
    if(media.purpose==='receipt'&&!authorized){
      authorized=!!user&&(user.role==='owner'||(user.role==='manager'&&!!user.financial));
    }
    if(media.purpose!=='receipt'&&!authorized&&media.site_id&&user&&['owner','manager','moderator'].includes(user.role)){
      if(user.role!=='moderator'){try{await siteFor(c,media.site_id);authorized=true;}catch{}}
      else authorized=!!await one(c,"SELECT id FROM reviews WHERE site_id=? AND instr(snapshot,?)>0 LIMIT 1",media.site_id,'/api/media/'+media.id);
    }
    if(media.purpose!=='receipt'&&!authorized){
      const site:any=media.site_id?await one(c,"SELECT * FROM sites WHERE id=? AND status='published'",media.site_id):null;
      if(site?.published&&await personalGate(c,site))authorized=publishedReferencesMedia(publishedJson(site),media.id);
    }
    if(!authorized)throw new HTTPException(403,{message:'الملف خاص أو غير منشور'});
    const object=await c.env.MEDIA.get(media.bucket_key);
    if(!object)throw new HTTPException(404);
    return new Response(object.body,{headers:{
      'Content-Type':media.mime,
      'Cache-Control':'private, no-store',
      'X-Content-Type-Options':'nosniff',
      ...(media.purpose==='receipt'?{'Content-Disposition':'attachment; filename="receipt.'+(media.mime==='application/pdf'?'pdf':'webp')+'"'}:{}),
    }});
  });

  app.post('/api/public/event',async c=>{
    const data=z.object({event:z.enum(['visit','contact','vcard','qr']),site:z.string().uuid()}).parse(await c.req.json());
    const site=await publishedForHost(c);
    if(site.id!==data.site||!await personalGate(c,site))throw new HTTPException(403);
    await rate(c,'event:'+site.id+':'+c.req.header('CF-Connecting-IP'),100,3600);
    await run(c,'INSERT INTO analytics(site_id,event,created_at) VALUES(?,?,?)',site.id,data.event,now());
    return c.json({ok:true});
  });
}
