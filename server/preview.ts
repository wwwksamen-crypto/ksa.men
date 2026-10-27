import type {App,Ctx} from './core';
import {one,role,siteFor,publicProfile} from './core';
import {HTTPException} from 'hono/http-exception';
const escape=(text:any)=>String(text??'').replace(/[&<>"']/g,value=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[value]!));
export function registerPreview(app:App){
 app.get('/api/admin/reviews/:id/preview',async c=>{
  const user=role(c,['owner','manager','moderator']);
  const review:any=await one(c,'SELECT * FROM reviews WHERE id=?',c.req.param('id'));
  if(!review)throw new HTTPException(404);
  if(user.role==='manager')await siteFor(c,review.site_id);
  const p=JSON.parse(review.snapshot||'{}');
  const image=(url:string)=>/^\/api\/media\/[a-zA-Z0-9-]+$/.test(url)||/^\/assets\/[a-zA-Z0-9-]+\.(png|webp)$/.test(url)?url:'';
  const list=(key:string,title:string)=>Array.isArray(p[key])&&p[key].length?'<section><h2>'+title+'</h2>'+p[key].map((item:any)=>'<article>'+Object.entries(typeof item==='object'&&item!==null?item:{value:item}).filter(([key])=>!['id','hidden','url'].includes(key)).map(([,value])=>'<p>'+escape(value)+'</p>').join('')+'</article>').join('')+'</section>':'';
  const galleries=[...(p.skillImages||[]),...(p.workImages||[])].filter((v:any)=>typeof v==='string'&&image(v));
  const body=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>معاينة لقطة المراجعة — KSA.MEN</title><style>@font-face{font-family:Tajawal;src:url('/assets/Tajawal-Regular.ttf')}*{box-sizing:border-box}body{margin:0;background:#07120f;color:#f5f7f6;font-family:Tajawal,Arial;padding:24px}.shell{max-width:980px;margin:auto}.notice{background:#173225;padding:16px;border:1px solid #355841;border-radius:12px;color:#b9e9cc}header{padding:38px 24px;border-radius:24px;background:linear-gradient(130deg,#004422,#0b1b14);margin-top:20px}h1{font-size:42px}h2{color:#8ee5af}section{padding:24px;border:1px solid #294d36;border-radius:18px;margin:18px 0}article{border-bottom:1px solid #294d36;padding:12px}.photo{width:140px;height:140px;object-fit:contain;border-radius:24px;background:#fff}.cover{width:100%;max-height:310px;object-fit:cover;border-radius:18px}.gallery{display:flex;flex-wrap:wrap;gap:12px}.gallery img{width:min(100%,270px);border-radius:14px}p{white-space:pre-wrap;line-height:1.8}</style></head><body><main class="shell"><p class="notice">معاينة محمية للّقطة المرسلة v${Number(review.draft_version)} فقط. لا تغيّر النسخة المنشورة أو المسودة الأحدث.</p>${image(p.cover)?'<img class="cover" src="'+image(p.cover)+'" alt="غلاف الهوية">':''}<header>${image(p.photo)?'<img class="photo" src="'+image(p.photo)+'" alt="صورة الهوية">':''}<h1>${escape(p.name)}</h1><h2>${escape(p.title)}</h2><p>${escape(p.bio)}</p><p>${escape(p.city)} · ${escape(p.country)}</p></header>${list('experience','الخبرات')}${list('education','المؤهلات')}${list('training','التطوير والتدريب')}${list('skills','المهارات')}${list('memberships','العضويات')}${list('languages','اللغات')}${list('hobbies','الهوايات')}${list('achievements','الإنجازات')}${list('timeline','السجل الزمني')}<section><h2>وسائل الاتصال والمشاركة</h2><p>${escape(p.email)}</p><p>${escape(p.phone||p.whatsapp)}</p>${list('socials','الروابط الاجتماعية')}${list('buttons','الأزرار المخصصة')}</section>${galleries.length?'<section><h2>صور الإثبات ونماذج الأعمال</h2><div class="gallery">'+galleries.map((url:string)=>'<img src="'+image(url)+'" alt="عنصر مرئي من اللقطة">').join('')+'</div></section>':''}</main></body></html>`;
  return c.html(body);
 });
}
