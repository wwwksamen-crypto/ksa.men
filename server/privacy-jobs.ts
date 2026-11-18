import type { Env } from './core';
import { now, uid } from './core';
import { selfExport, MAX_PRIVATE_EXPORT_BYTES } from './privacy-export';

export type PrivacyPolicy = {enabled:boolean;policyVersion:string;downloadHours:number;responseDays:number};
/** Enabling requires a complete, explicitly approved configuration, never a migration default. */
export async function privacyPolicy(env:Env):Promise<PrivacyPolicy> {
  const row=await env.DB.prepare("SELECT value FROM settings WHERE key='privacy_rights'").first<{value:string}>();
  let p:Partial<PrivacyPolicy>={};try{p=row?JSON.parse(row.value):{};}catch{}
  const valid=p.enabled===true&&typeof p.policyVersion==='string'&&p.policyVersion.length>=3&&p.policyVersion.length<=100
    &&Number.isInteger(p.downloadHours)&&Number(p.downloadHours)>=1&&Number(p.downloadHours)<=72
    &&Number.isInteger(p.responseDays)&&Number(p.responseDays)>=1&&Number(p.responseDays)<=90;
  return valid? p as PrivacyPolicy:{enabled:false,policyVersion:'',downloadHours:0,responseDays:0};
}
export async function privateFileHash(bytes:Uint8Array):Promise<string> {
  const hash=await crypto.subtle.digest('SHA-256',bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(hash)).map(x=>x.toString(16).padStart(2,'0')).join('');
}
function changes(result:any){return Number(result?.meta?.changes??0);}
type Job={id:string;request_id:string;user_id:number|null;policy_version:string;attempts:number};
const LIVE_SUBJECT=`EXISTS(SELECT 1 FROM users u JOIN privacy_requests r ON r.user_id=u.id WHERE r.id=? AND u.status='active'
  AND NOT EXISTS(SELECT 1 FROM deleted_tombstones t WHERE t.resource_type='account' AND t.resource_id=CAST(u.id AS TEXT)))`;
async function cancelUnavailable(env:Env,job:Job) {
  const clock=now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE operational_jobs SET status='cancelled',lease_until=NULL,completed_at=? WHERE id=? AND status IN ('pending','running','failed') AND NOT ${LIVE_SUBJECT}`).bind(clock,job.id,job.request_id),
    env.DB.prepare(`UPDATE privacy_requests SET status='cancelled',updated_at=? WHERE id=? AND status<>'cancelled' AND EXISTS(SELECT 1 FROM operational_jobs WHERE id=? AND status='cancelled')`).bind(clock,job.request_id,job.id),
    env.DB.prepare(`INSERT INTO privacy_request_events(id,request_id,actor_id,status,event_code,created_at) SELECT ?,?,NULL,'cancelled','subject_unavailable',? WHERE changes()=1`).bind(uid(),job.request_id,clock),
  ]);
}
function errorCode(error:unknown) {
  const message=error instanceof Error?error.message:'';
  return ['export_requires_assistance','export_subject_unavailable','export_invalid_profile','export_policy_changed','export_write_unverified'].includes(message)?message:'export_storage_or_commit_failed';
}

/** Finite native Worker work, maximum two jobs per invocation; no email, deletion or AI. */
export async function processPrivacyJobs(env:Env,requestId?:string):Promise<void> {
  const policy=await privacyPolicy(env);if(!policy.enabled)return;
  const clock=now();
  const selected=(await env.DB.prepare(`SELECT j.id,j.request_id,r.user_id,r.policy_version,j.attempts FROM operational_jobs j
    JOIN privacy_requests r ON r.id=j.request_id WHERE j.kind='privacy_export' AND j.attempts<3
    AND ((j.status IN ('pending','failed') AND j.next_attempt_at<=?) OR (j.status='running' AND j.lease_until<=?))
    ${requestId?'AND r.id=?':''} ORDER BY j.created_at,j.id LIMIT 2`).bind(clock,clock,...(requestId?[requestId]:[])).all<Job>()).results;
  for(const job of selected) {
    const token=uid();
    const claimed=await env.DB.batch([
      env.DB.prepare(`UPDATE operational_jobs SET status='running',attempts=attempts+1,lease_token=?,lease_until=?,last_error_code=NULL
        WHERE id=? AND attempts<3 AND ((status IN ('pending','failed') AND next_attempt_at<=?) OR (status='running' AND lease_until<=?)) AND ${LIVE_SUBJECT}`)
        .bind(token,clock+300,job.id,clock,clock,job.request_id),
      env.DB.prepare(`UPDATE privacy_requests SET status='processing',updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM operational_jobs WHERE id=? AND status='running' AND lease_token=?)`).bind(clock,job.request_id,job.id,token),
      env.DB.prepare(`INSERT INTO privacy_request_events(id,request_id,actor_id,status,event_code,created_at)
        SELECT ?,?,NULL,'processing','export_started',? WHERE EXISTS(SELECT 1 FROM operational_jobs WHERE id=? AND status='running' AND lease_token=?)`).bind(uid(),job.request_id,clock,job.id,token),
    ]);
    if(!changes(claimed[0])){await cancelUnavailable(env,job);continue;}
    const key=`privacy-exports/${job.request_id}/${token}.json`;
    const gate=`EXISTS(SELECT 1 FROM operational_jobs WHERE id=? AND status='running' AND lease_token=? AND lease_until>?) AND ${LIVE_SUBJECT}`;
    const args=()=>[job.id,token,now(),job.request_id];
    try {
      if(job.policy_version!==policy.policyVersion)throw new Error('export_policy_changed');
      const bytes=await selfExport(env,Number(job.user_id),job.policy_version),sha=await privateFileHash(bytes);
      const intent=await env.DB.prepare(`UPDATE operational_jobs SET artifact_keys=json_insert(artifact_keys,'$[#]',?) WHERE id=? AND status='running' AND lease_token=? AND lease_until>?`).bind(key,job.id,token,now()).run();
      if(!changes(intent))continue;
      await env.MEDIA.put(key,bytes,{httpMetadata:{contentType:'application/json'},customMetadata:{sha256:sha,requestId:job.request_id}});
      const stored=await env.MEDIA.get(key);
      if(!stored||stored.size!==bytes.byteLength||stored.size>MAX_PRIVATE_EXPORT_BYTES)throw new Error('export_write_unverified');
      const actual=new Uint8Array(await stored.arrayBuffer());
      if(await privateFileHash(actual)!==sha)throw new Error('export_write_unverified');
      const currentPolicy=await privacyPolicy(env);
      if(!currentPolicy.enabled||currentPolicy.policyVersion!==job.policy_version||currentPolicy.downloadHours!==policy.downloadHours)throw new Error('export_policy_changed');
      const readyAt=now(),expiresAt=readyAt+policy.downloadHours*3600;
      const committed=await env.DB.batch([
        env.DB.prepare(`INSERT INTO privacy_export_artifacts(request_id,user_id,bucket_key,sha256,bytes,generated_at,expires_at)
          SELECT ?,?,?,?,?,?,? WHERE ${gate}
          ON CONFLICT(request_id) DO UPDATE SET user_id=excluded.user_id,bucket_key=excluded.bucket_key,sha256=excluded.sha256,bytes=excluded.bytes,generated_at=excluded.generated_at,expires_at=excluded.expires_at`)
          .bind(job.request_id,job.user_id,key,sha,bytes.byteLength,readyAt,expiresAt,...args()),
        env.DB.prepare(`UPDATE privacy_requests SET status='ready',updated_at=? WHERE id=? AND ${gate}`).bind(readyAt,job.request_id,...args()),
        env.DB.prepare(`INSERT INTO privacy_request_events(id,request_id,actor_id,status,event_code,created_at)
          SELECT ?,?,NULL,'ready','export_verified',? WHERE ${gate}`).bind(uid(),job.request_id,readyAt,...args()),
        env.DB.prepare(`UPDATE operational_jobs SET status='succeeded',completed_at=?,lease_until=NULL WHERE id=? AND status='running' AND lease_token=?
          AND EXISTS(SELECT 1 FROM privacy_requests WHERE id=? AND status='ready')`).bind(readyAt,job.id,token,job.request_id),
      ]);
      if(!changes(committed[0])||!changes(committed[1])||!changes(committed[3])){await cancelUnavailable(env,job);continue;}
    } catch(error) {
      const code=errorCode(error),failedAt=now();
      const retryable=!['export_subject_unavailable','export_requires_assistance','export_invalid_profile','export_policy_changed'].includes(code);
      const attempts=job.attempts+1;
      const next=failedAt+Math.min(3600,60*2**attempts);
      await env.DB.batch([
        env.DB.prepare(`UPDATE operational_jobs SET status='failed',lease_until=NULL,next_attempt_at=?,last_error_code=?,attempts=CASE WHEN ? THEN attempts ELSE 3 END
          WHERE id=? AND status='running' AND lease_token=?`).bind(next,code,Number(retryable),job.id,token),
        env.DB.prepare(`UPDATE privacy_requests SET status='failed',updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM operational_jobs WHERE id=? AND status='failed' AND lease_token=?)`).bind(failedAt,job.request_id,job.id,token),
        env.DB.prepare(`INSERT INTO privacy_request_events(id,request_id,actor_id,status,event_code,created_at)
          SELECT ?,?,NULL,'failed',?,? WHERE EXISTS(SELECT 1 FROM operational_jobs WHERE id=? AND status='failed' AND lease_token=?)`).bind(uid(),job.request_id,code,failedAt,job.id,token),
      ]);
      await cancelUnavailable(env,job);
    }
  }
}
