import type { App, Env, Ctx } from './core';
import { role, fresh, now, uid, audit, all, digest } from './core';
import { HTTPException } from 'hono/http-exception';

const excludedAuth = ['auth_codes', 'sessions', 'devices', 'rate_limits'];
const privateCommunication = ['conversations', 'messages', 'contact_requests', 'blocks', 'reports'];
const magic=new TextEncoder().encode('KSA2');

type BackupKey={key:CryptoKey;id:string};
async function keyFromSecret(secret:string):Promise<BackupKey>{
 const material=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret));
 return {key:await crypto.subtle.importKey('raw',material,{name:'AES-GCM'},false,['encrypt','decrypt']),id:(await digest(secret)).slice(0,16)};
}
async function backupKeys(env:Env):Promise<BackupKey[]>{
 const active=env.BACKUP_ENCRYPTION_KEY?.trim();
 if(!active)throw new HTTPException(503,{message:'مفتاح تشفير النسخ المستقل غير مهيأ بعد'});
 const values=[active,env.BACKUP_ENCRYPTION_PREVIOUS_KEY?.trim()].filter((item):item is string=>Boolean(item));
 const keys:BackupKey[]=[];for(const value of values){const item=await keyFromSecret(value);if(!keys.some(existing=>existing.id===item.id))keys.push(item);}return keys;
}
async function sha256(bytes: Uint8Array) {const hash=await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer);return Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join('');}
function tombstoneSets(tables:Record<string,any[]>){
 const sets=new Map<string,Set<string>>();for(const row of tables.deleted_tombstones||[]){if(row&&typeof row.resource_type==='string'&&row.resource_id!==undefined){if(!sets.has(row.resource_type))sets.set(row.resource_type,new Set());sets.get(row.resource_type)!.add(String(row.resource_id));}}
 return sets;
}
/** Removes rows known destroyed at snapshot time. Live restore also applies its current tombstone set. */
export function scrubTombstones(tables:Record<string,any[]>){
 const removed:{[key:string]:number}={};const sets=tombstoneSets(tables);
 const filter=(table:string,type:string,key:string)=>{const tombstones=sets.get(type);if(!tombstones||!Array.isArray(tables[table]))return;const before=tables[table].length;tables[table]=tables[table].filter(row=>!tombstones.has(String(row?.[key])));if(before!==tables[table].length)removed[table]=(removed[table]||0)+before-tables[table].length;};
 filter('users','account','id');filter('sites','site','id');filter('media','media','id');filter('conversations','conversation','id');filter('messages','message','id');
 const conversations=sets.get('conversation');
 if(conversations&&Array.isArray(tables.messages)){
  const before=tables.messages.length;tables.messages=tables.messages.filter(row=>!conversations.has(String(row?.conversation_id)));
  if(before!==tables.messages.length)removed.messages=(removed.messages||0)+before-tables.messages.length;
 }
 const accounts=sets.get('account');if(accounts){for(const table of ['wallets','user_services','entitlement_sources','consent_records','notifications','quick_links','subscription_requests','sessions','devices'])if(Array.isArray(tables[table])){const before=tables[table].length;tables[table]=tables[table].filter(row=>!accounts.has(String(row?.user_id)));if(before!==tables[table].length)removed[table]=(removed[table]||0)+before-tables[table].length;}}
 const sites=sets.get('site');if(sites){for(const table of ['dns_names','names','analytics','proxy_media','proxy_sites','site_custody'])if(Array.isArray(tables[table])){const before=tables[table].length;tables[table]=tables[table].filter(row=>!sites.has(String(row?.site_id)));if(before!==tables[table].length)removed[table]=(removed[table]||0)+before-tables[table].length;}}
 return removed;
}
export async function makeBackup(env:Env,reason='nightly') {
 const schema=(await env.DB.prepare("SELECT name,type,sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND sql IS NOT NULL").all<{name:string,type:string,sql:string}>()).results;
 const tables:Record<string,any[]>={};for(const item of schema.filter(item=>item.type==='table')){if(!/^[a-z_][a-z0-9_]*$/i.test(item.name)||excludedAuth.includes(item.name))continue;tables[item.name]=(await env.DB.prepare('SELECT * FROM '+item.name).all()).results;}
 const keys=await backupKeys(env);const payload={format:'ksa-men-backup-v2',createdAt:now(),reason,tables,schema,excluded:excludedAuth,mediaStorage:'ksa-men-prod-media',mediaImmutable:true,keyId:keys[0].id};
 const plain=new TextEncoder().encode(JSON.stringify(payload));const hash=await sha256(plain);const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},keys[0].key,plain);
 const bytes=new Uint8Array(magic.length+12+encrypted.byteLength);bytes.set(magic);bytes.set(iv,magic.length);bytes.set(new Uint8Array(encrypted),magic.length+12);
 const id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+uid();await env.MEDIA.put('backups/'+id+'.ksab',bytes,{httpMetadata:{contentType:'application/octet-stream'},customMetadata:{sha256:hash,createdAt:String(now()),reason,format:'ksa-men-backup-v2',keyId:keys[0].id}});
 return {id,sha256:hash,createdAt:now(),encrypted:true,bytes:bytes.byteLength,tableCount:Object.keys(tables).length,keyId:keys[0].id};
}
async function decryptSnapshot(env:Env,bytes:Uint8Array){
 if(!bytes.slice(0,4).every((item,index)=>item===magic[index]))throw new HTTPException(409,{message:'هذه نسخة قديمة تتطلب أداة الاستعادة المعزولة الخاصة بها'});
 const keys=await backupKeys(env);let last:unknown;
 for(const candidate of keys){try{return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(4,16)},candidate.key,bytes.slice(16)));}catch(error){last=error;}}
 throw new HTTPException(409,{message:'تعذر فك النسخة بالمفتاح النشط أو مفتاح التدوير السابق'});
}
async function snapshot(c:Ctx) {
 role(c,['owner']);fresh(c);const id=c.req.param('id')||'';if(!/^[a-zA-Z0-9-]{20,100}$/.test(id))throw new HTTPException(400,{message:'معرف النسخة غير صحيح'});const object=await c.env.MEDIA.get('backups/'+id+'.ksab');if(!object)throw new HTTPException(404,{message:'النسخة غير موجود'});
 const bytes=new Uint8Array(await object.arrayBuffer());const plain=await decryptSnapshot(c.env,bytes);const checksum=await sha256(plain);if(object.customMetadata?.sha256&&object.customMetadata.sha256!==checksum)throw new HTTPException(409,{message:'بصمة النسخة لا تطابق المحتوى'});const data=JSON.parse(new TextDecoder().decode(plain));if(data.format!=='ksa-men-backup-v2'||!data.tables)throw new HTTPException(409,{message:'تنسيق النسخة غير مدعوم'});scrubTombstones(data.tables);return {id,object,bytes,data,checksum};
}
export function registerBackup(app:App) {
 app.get('/api/admin/backups',async c=>{role(c,['owner']);fresh(c);const list=await c.env.MEDIA.list({prefix:'backups/',limit:100,include:['customMetadata']});return c.json({backups:list.objects.map(object=>({id:object.key.slice(8).replace(/\.ksab$/,''),bytes:object.size,createdAt:object.customMetadata?.createdAt,sha256:object.customMetadata?.sha256,keyId:object.customMetadata?.keyId})),truncated:list.truncated});});
 app.post('/api/admin/backups/create',async c=>{role(c,['owner']);fresh(c);const backup=await makeBackup(c.env,'owner');await audit(c,'backup.create',backup.id);return c.json(backup);});
 app.post('/api/admin/backups/:id/verify',async c=>{const {id,data,checksum}=await snapshot(c);let missingMedia=0;for(const media of data.tables.media||[]){if(!await c.env.MEDIA.get(media.bucket_key))missingMedia++;}await audit(c,'backup.verify',id,{missingMedia,tableCount:Object.keys(data.tables).length});return c.json({verified:true,sha256:checksum,tableCount:Object.keys(data.tables).length,rowCount:Object.values(data.tables).reduce((total:number,rows:any)=>total+rows.length,0),missingMedia,restoration:'Validated snapshot; no production data was modified.'});});
 app.get('/api/admin/backups/:id/encrypted',async c=>{const {id,bytes,checksum}=await snapshot(c);await audit(c,'backup.download.encrypted',id,{encrypted:true});return new Response(bytes,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="ksa-men-'+id+'.ksab"','X-Backup-SHA256':checksum,'Cache-Control':'private, no-store'}});});
 app.get('/api/admin/backups/:id',async c=>{const {id,data}=await snapshot(c);data.excluded=[...excludedAuth,...privateCommunication,'users.pin_hash','sites.lock_hash','settings.lock.passwordHash'];for(const table of [...excludedAuth,...privateCommunication])delete data.tables[table];for(const user of data.tables.users||[])delete user.pin_hash;for(const site of data.tables.sites||[])delete site.lock_hash;for(const row of data.tables.settings||[]){if(row.key==='lock'){const value=JSON.parse(row.value);delete value.passwordHash;row.value=JSON.stringify(value);}}for(const table of Object.keys(data.tables))if(table.includes('report')||table.includes('evidence'))delete data.tables[table];await audit(c,'backup.download',id,{ordinaryExport:true});const output=JSON.stringify(data);const checksum=await sha256(new TextEncoder().encode(output));return new Response(output,{headers:{'Content-Type':'application/json','Content-Disposition':'attachment; filename="ksa-men-'+id+'.json"','X-Backup-SHA256':checksum,'Cache-Control':'private, no-store'}});});
}
