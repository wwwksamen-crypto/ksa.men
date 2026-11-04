import { referralCode } from '../../shared/referral';
const KEY = 'ksa-referral-source-v1';
const LIFETIME = 30 * 86400 * 1000;
type Source = { code: string; expiresAt: number; tracked: boolean };
const ongoing = new Set<string>();
function read(storage: Storage): Source | null {
  try { const value=JSON.parse(storage.getItem(KEY)||'null');const code=referralCode(value?.code);if(!code || !Number.isFinite(value.expiresAt) || value.expiresAt<=Date.now()){storage.removeItem(KEY);return null;}return {code,expiresAt:value.expiresAt,tracked:value.tracked===true}; } catch {return null;}
}
export function captureReferral(search: string, storage: Storage | undefined = safeStorage()): string {
  const incoming=referralCode(new URLSearchParams(search).get('ref'));
  if(!storage)return incoming;
  const existing=read(storage);if(existing)return existing.code;
  if(incoming)try{storage.setItem(KEY,JSON.stringify({code:incoming,expiresAt:Date.now()+LIFETIME,tracked:false}));}catch{/* Referral still accompanies this form. */}
  return incoming;
}
function safeStorage(): Storage | undefined {try{return window.localStorage;}catch{return undefined;}}
export function clearReferral(storage: Storage | undefined = safeStorage()) {try{storage?.removeItem(KEY);}catch{/* Login must not depend on browser storage. */}}
export async function trackReferral(code:string, post:(code:string)=>Promise<unknown>, storage:Storage|undefined=safeStorage()) {
  if(!code || ongoing.has(code))return;const value=storage?read(storage):null;if(value?.tracked)return;
  ongoing.add(code);
  try{await post(code);if(storage && read(storage)?.code===code)storage.setItem(KEY,JSON.stringify({code,expiresAt:value?.expiresAt||Date.now()+LIFETIME,tracked:true}));}catch{/* Optional anonymous measurement must not block account creation. */}
  finally{ongoing.delete(code);}
}
