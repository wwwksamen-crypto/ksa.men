import type {Env} from './core';
import {now} from './core';
export type ErasureContext={generatedAt:number;deleted_tombstones:any[];retained_sites:any[]};
export async function currentErasureContext(env:Env):Promise<ErasureContext>{
 const deleted_tombstones=(await env.DB.prepare('SELECT resource_type,resource_id,deleted_at,source FROM deleted_tombstones').all()).results;
 const retained_sites=(await env.DB.prepare("SELECT id,user_id,manager_id,authorization,status FROM sites WHERE user_id IS NULL AND status NOT IN ('deleted','deletion_pending')").all()).results;
 return {generatedAt:now(),deleted_tombstones,retained_sites};
}
/** Presentation/recovery payload only; never modifies an encrypted historical object. */
export function applyCurrentErasure(tables:Record<string,any[]>,context:ErasureContext){
 const rows=[...(tables.deleted_tombstones||[]),...context.deleted_tombstones];
 const unique=new Map(rows.map(r=>[`${r.resource_type}:${r.resource_id}`,r]));
 tables.deleted_tombstones=[...unique.values()];
 const accounts=new Set(rows.filter(r=>r.resource_type==='account').map(r=>String(r.resource_id)));
 const retained=new Map(context.retained_sites.map(s=>[String(s.id),s]));
 for(const site of tables.sites||[]){
  const live=retained.get(String(site.id));
  if(live&&accounts.has(String(site.user_id))){site.user_id=null;site.manager_id=live.manager_id;site.authorization=live.authorization;}
 }
 for(const row of tables.dns_names||[]){const live=retained.get(String(row.site_id));if(live&&accounts.has(String(row.owner_id)))row.owner_id=live.manager_id;}
 for(const row of tables.media||[]){const live=retained.get(String(row.site_id));if(live&&accounts.has(String(row.owner_id)))row.owner_id=live.manager_id;}
}
