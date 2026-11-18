import type { Env } from './core';
import { now } from './core';

const profileKeys = new Set(['name','title','specialty','bio','email','phone','whatsapp','city','country','photo','avatarMode','cover','youtube','experience','education','training','skills','memberships','languages','hobbies','achievements','timeline','skillRadar','blog','notes','skillImages','workImages','socials','buttons','hidden','searchable','allowContact','itemIds','hiddenItems','imageDescriptions']);
const itemKeys = new Set(['id','label','name','title','value','level','description','organization','institution','start','end','date','url','href','language','proficiency','skill']);
const lists = new Set(['experience','education','training','skills','memberships','languages','hobbies','achievements','timeline','socials','buttons']);
function object(value:unknown):Record<string,unknown> {return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function parsed(value:unknown):Record<string,unknown>{try{return object(typeof value==='string'?JSON.parse(value):value);}catch{throw new Error('export_invalid_profile');}}
export function selfProfile(value:unknown,translated=false):Record<string,unknown> {
  const input=parsed(value),output:Record<string,unknown>={};
  for(const key of profileKeys) {
    const item=input[key];if(item===undefined)continue;
    if(lists.has(key)) {
      if(!Array.isArray(item))continue;
      output[key]=item.map(entry=>typeof entry==='string'?entry:Object.fromEntries(Object.entries(object(entry)).filter(([k,v])=>itemKeys.has(k)&&['string','number','boolean'].includes(typeof v))));
    } else if(key==='skillRadar') {
      output[key]=Object.fromEntries(['human','scientific','professional'].map(k=>[k,Array.isArray(object(item)[k])?(object(item)[k] as unknown[]).filter(v=>typeof v==='string'):[]]));
    } else if(key==='itemIds'||key==='imageDescriptions') {
      output[key]=Object.fromEntries(Object.entries(object(item)).filter(([,v])=>typeof v==='string'||Array.isArray(v)&&v.every(x=>typeof x==='string')));
    } else if(Array.isArray(item))output[key]=item.filter(v=>typeof v==='string');
    else if(['string','number','boolean'].includes(typeof item)||item===null)output[key]=item;
  }
  if(!translated&&input.translations) {
    const tr=object(input.translations);output.translations=Object.fromEntries(['ar','en'].filter(lang=>tr[lang]).map(lang=>[lang,selfProfile(tr[lang],true)]));
  }
  return output;
}
export const MAX_PRIVATE_EXPORT_BYTES=4*1024*1024;
const MAX_ROWS=1000;
async function rows(env:Env,sql:string,...params:unknown[]) {
  const result=(await env.DB.prepare(sql+' LIMIT '+(MAX_ROWS+1)).bind(...params).all<Record<string,unknown>>()).results;
  if(result.length>MAX_ROWS)throw new Error('export_requires_assistance');
  return result;
}
/** Never load all accounts and filter afterward. Every query is subject-scoped. */
export async function selfExport(env:Env,userId:number,policyVersion:string) {
  const account=await env.DB.prepare(`SELECT id,email,name,whatsapp,role,status,created_at,trial_until,entitlement_until,consent_at FROM users WHERE id=? AND status='active'
    AND NOT EXISTS(SELECT 1 FROM deleted_tombstones WHERE resource_type='account' AND resource_id=CAST(users.id AS TEXT))`).bind(userId).first<Record<string,unknown>>();
  if(!account)throw new Error('export_subject_unavailable');
  const managed=await env.DB.prepare('SELECT contact_email FROM managed_accounts WHERE user_id=?').bind(userId).first<{contact_email:string}>();
  if(managed)account.email=managed.contact_email;
  const size=await env.DB.prepare("SELECT COALESCE(SUM(LENGTH(CAST(draft AS BLOB))+COALESCE(LENGTH(CAST(published AS BLOB)),0)),0) AS bytes FROM sites WHERE user_id=? AND status<>'deleted'").bind(userId).first<{bytes:number}>();
  if(Number(size?.bytes)>MAX_PRIVATE_EXPORT_BYTES)throw new Error('export_requires_assistance');
  const sites=await rows(env,"SELECT id,draft,published,draft_version,published_version,status,searchable,allow_contact,branding,created_at,updated_at FROM sites WHERE user_id=? AND status<>'deleted' AND NOT EXISTS(SELECT 1 FROM deleted_tombstones t WHERE t.resource_type='site' AND t.resource_id=sites.id) ORDER BY id",userId);
  const consents=await rows(env,'SELECT id,purpose,notice_version,question,affirmation,source,granted_at,withdrawn_at FROM consent_records WHERE user_id=? ORDER BY granted_at,id',userId);
  const media=await rows(env,"SELECT m.id,m.site_id,m.purpose,m.mime,m.size,m.public,m.created_at FROM media m WHERE m.owner_id=? AND NOT EXISTS(SELECT 1 FROM deleted_tombstones t WHERE t.resource_type='media' AND t.resource_id=m.id) ORDER BY m.id",userId);
  const visibility=await rows(env,'SELECT site_id,visible,listed,indexable,hidden_fields,hidden_items,version,updated_at FROM site_visibility WHERE site_id IN (SELECT id FROM sites WHERE user_id=? AND status<>\'deleted\') ORDER BY site_id',userId);
  const addresses=await rows(env,'SELECT name,site_id,created_at FROM dns_names WHERE site_id IN (SELECT id FROM sites WHERE user_id=? AND status<>\'deleted\') ORDER BY name',userId);
  const reviews=await rows(env,'SELECT id,site_id,draft_version,base_version,status,created_at,decided_at FROM reviews WHERE user_id=? ORDER BY created_at,id',userId);
  const ledger=await rows(env,'SELECT id,amount,kind,created_at,CASE WHEN to_id=? THEN \'incoming\' ELSE \'outgoing\' END AS direction FROM ledger WHERE from_id=? OR to_id=? ORDER BY created_at,id',userId,userId,userId);
  const payments=await rows(env,'SELECT id,amount,days,receipt_id,status,created_at,approved_at FROM payments WHERE user_id=? ORDER BY created_at,id',userId);
  const subscriptions=await rows(env,'SELECT id,start_at,end_at FROM subscriptions WHERE user_id=? ORDER BY start_at,id',userId);
  const rights=await rows(env,'SELECT id,type,status,message,public_response,policy_version,due_at,created_at,updated_at FROM privacy_requests WHERE user_id=? ORDER BY created_at,id',userId);
  const preferences=await env.DB.prepare('SELECT age_band,seasonal_theme_enabled,seasonal_notices_enabled,badges_enabled,updated_at FROM member_preferences WHERE user_id=?').bind(userId).first();
  const seasonalConsent=await env.DB.prepare('SELECT status,granted_at,withdrawn_at,updated_at FROM loyalty_notification_consents WHERE user_id=?').bind(userId).first();
  const wallet=await env.DB.prepare('SELECT balance FROM wallets WHERE user_id=?').bind(userId).first();
  const data={format:'ksa-men-self-data-v1',generatedAt:now(),policyVersion,account,
    sites:sites.map(s=>({...s,draft:selfProfile(s.draft),published:s.published?selfProfile(s.published):null})),consents,preferences,seasonalConsent,visibility,addresses,media,wallet,ledger,payments,subscriptions,reviews,rights,
    coverage:{subjectOnly:true,mediaContent:'references-only',notABackup:true,excluded:['authentication_secrets','sessions_and_trusted_device_tokens','other_members_and_counterparties','restricted_evidence','internal_administrator_notes','operational_capabilities','removed_resources','unknown_internal_fields']}};
  const bytes=new TextEncoder().encode(JSON.stringify(data));
  if(bytes.byteLength>MAX_PRIVATE_EXPORT_BYTES)throw new Error('export_requires_assistance');
  return bytes;
}
