import type { App, Env, Ctx } from './core';
import { role, fresh, now, uid, audit, all } from './core';
import { HTTPException } from 'hono/http-exception';

const excludedAuth = ['auth_codes', 'sessions', 'devices', 'rate_limits'];
const privateCommunication = ['conversations', 'messages', 'contact_requests', 'blocks', 'reports'];
async function encryptionKey(env: Env) {
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.AUTH_SECRET+':ksa-backup-v1'));
 return crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
async function sha256(bytes: Uint8Array) {
 const hash=await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer);
 return Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join('');
}
export async function makeBackup(env:Env,reason='nightly') {
 const schema=(await env.DB.prepare("SELECT name,type,sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND sql IS NOT NULL").all<{name:string,type:string,sql:string}>()).results;
 const tables:Record<string,any[]>={};
 for(const item of schema.filter(item=>item.type==='table')) {
  if(!/^[a-z_][a-z0-9_]*$/i.test(item.name)||excludedAuth.includes(item.name))continue;
  tables[item.name]=(await env.DB.prepare('SELECT * FROM '+item.name).all()).results;
 }
 const payload={format:'ksa-men-backup-v1',createdAt:now(),reason,tables,schema,excluded:excludedAuth,mediaStorage:'ksa-men-prod-media',mediaImmutable:true};
 const plain=new TextEncoder().encode(JSON.stringify(payload));
 const hash=await sha256(plain);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(env),plain);
 const bytes=new Uint8Array(12+encrypted.byteLength);bytes.set(iv);bytes.set(new Uint8Array(encrypted),12);
 const id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+uid();
 await env.MEDIA.put('backups/'+id+'.ksab',bytes,{httpMetadata:{contentType:'application/octet-stream'},customMetadata:{sha256:hash,createdAt:String(now()),reason,format:'ksa-men-backup-v1'}});
 return {id,sha256:hash,createdAt:now(),encrypted:true,bytes:bytes.byteLength,tableCount:Object.keys(tables).length};
}
async function snapshot(c:Ctx) {
 role(c,['owner']);fresh(c);
 const id=c.req.param('id')||'';
 if(!/^[a-zA-Z0-9-]{20,100}$/.test(id))throw new HTTPException(400,{message:'معرف النسخة غير صحيح'});
 const object=await c.env.MEDIA.get('backups/'+id+'.ksab');
 if(!object)throw new HTTPException(404,{message:'النسخة غير موجودة'});
 const bytes=new Uint8Array(await object.arrayBuffer());
 const plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},await encryptionKey(c.env),bytes.slice(12)));
 const checksum=await sha256(plain);
 if(object.customMetadata?.sha256&&object.customMetadata.sha256!==checksum)throw new HTTPException(409,{message:'بصمة النسخة لا تطابق المحتوى'});
 const data=JSON.parse(new TextDecoder().decode(plain));
 if(data.format!=='ksa-men-backup-v1'||!data.tables)throw new HTTPException(409,{message:'تنسيق النسخة غير مدعوم'});
 return {id,object,bytes,data,checksum};
}
export function registerBackup(app:App) {
 app.get('/api/admin/backups',async c=>{
  role(c,['owner']);fresh(c);
  const list=await c.env.MEDIA.list({prefix:'backups/',limit:100,include:['customMetadata']});
  return c.json({backups:list.objects.map(object=>({id:object.key.slice(8).replace(/\.ksab$/,''),bytes:object.size,createdAt:object.customMetadata?.createdAt,sha256:object.customMetadata?.sha256})),truncated:list.truncated});
 });
 app.post('/api/admin/backups/create',async c=>{
  role(c,['owner']);fresh(c);const backup=await makeBackup(c.env,'owner');await audit(c,'backup.create',backup.id);return c.json(backup);
 });
 app.post('/api/admin/backups/:id/verify',async c=>{
  const {id,data,checksum}=await snapshot(c);
  let missingMedia=0;
  for(const media of data.tables.media||[]){if(!await c.env.MEDIA.get(media.bucket_key))missingMedia++;}
  await audit(c,'backup.verify',id,{missingMedia,tableCount:Object.keys(data.tables).length});
  return c.json({verified:true,sha256:checksum,tableCount:Object.keys(data.tables).length,rowCount:Object.values(data.tables).reduce((total:number,rows:any)=>total+rows.length,0),missingMedia,restoration:'Validated snapshot; no production data was modified.'});
 });
 app.get('/api/admin/backups/:id/encrypted',async c=>{
  const {id,bytes,checksum}=await snapshot(c);await audit(c,'backup.download.encrypted',id,{encrypted:true});
  return new Response(bytes,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="ksa-men-'+id+'.ksab"','X-Backup-SHA256':checksum,'Cache-Control':'private, no-store'}});
 });
 app.get('/api/admin/backups/:id',async c=>{
  const {id,data}=await snapshot(c);
  data.excluded=[...excludedAuth,...privateCommunication,'users.pin_hash','sites.lock_hash','settings.lock.passwordHash'];
  for(const table of [...excludedAuth,...privateCommunication])delete data.tables[table];
  for(const user of data.tables.users||[])delete user.pin_hash;
  for(const site of data.tables.sites||[])delete site.lock_hash;
  for(const row of data.tables.settings||[]){if(row.key==='lock'){const value=JSON.parse(row.value);delete value.passwordHash;row.value=JSON.stringify(value);}}
  // Protected report evidence cannot reappear through a dependent backup table.
  for(const table of Object.keys(data.tables))if(table.includes('report')||table.includes('evidence'))delete data.tables[table];
  await audit(c,'backup.download',id,{ordinaryExport:true});
  const output=JSON.stringify(data);const checksum=await sha256(new TextEncoder().encode(output));
  return new Response(output,{headers:{'Content-Type':'application/json','Content-Disposition':'attachment; filename="ksa-men-'+id+'.json"','X-Backup-SHA256':checksum,'Cache-Control':'private, no-store'}});
 });
}
