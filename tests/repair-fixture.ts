import {describe,it,expect,vi,afterEach} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {webcrypto} from 'node:crypto';
import worker from '../server/index';
import {defaultProfile} from '../server/business';
import {digest,now,uid} from '../server/core';
import {runDataLifecycle} from '../server/lifecycle';
import {makeBackup} from '../server/backup';
import {publicationNotice} from '../server/publication-notice';
Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
afterEach(()=>vi.unstubAllGlobals());
export async function fixture(){
 const database=join(mkdtempSync(join(tmpdir(),'ksa-review-')),'synthetic.sqlite');
 function sql(payload:any):any{if(/^\s*(DELETE|DROP)\b/i.test(payload.sql||'')||(payload.batch||[]).some((x:any)=>/^\s*(DELETE|DROP)\b/i.test(x.sql||'')))throw Error('LOCAL DESTRUCTIVE SQL DISABLED');const r=spawnSync('python3',['scripts/sqlite_bridge.py'],{input:JSON.stringify({database,...payload}),encoding:'utf8'});const d=JSON.parse(r.stdout||'{}');if(d.error)throw Error(d.error);return d;}
 class Statement{params:any[]=[];constructor(public query:string){}bind(...p:any[]){this.params=p;return this;}async all(){return sql({sql:this.query,params:this.params});}async first(){return(await this.all()).results[0]??null;}async run(){return this.all();}}
 sql({setup:'migrations'});sql({sql:'UPDATE settings SET value=? WHERE key=?',params:['{"mode":"open"}','lock']});
 const actors:any={};
 for(const kind of ['owner','manager','member']){sql({sql:'INSERT INTO users(email,name,role,created_at,trial_until,consent_at) VALUES(?,?,?,?,?,?)',params:[kind+'@synthetic.invalid',kind,kind==='member'?'user':kind,now(),now()+86400,now()]});const id=sql({sql:'SELECT id FROM users WHERE email=?',params:[kind+'@synthetic.invalid']}).results[0].id;const raw=uid()+uid(),csrf=uid();sql({sql:'INSERT INTO sessions(id,user_id,csrf,expires_at,verified_at) VALUES(?,?,?,?,?)',params:[await digest(raw),id,csrf,now()+86400,now()]});actors[kind]={id,cookie:'__Host-ksa_session='+raw,csrf};}
 sql({sql:'UPDATE users SET assigned_to=? WHERE id=?',params:[actors.manager.id,actors.member.id]});
 const site=uid(),profile={...defaultProfile('SYNTHETIC MEMBER'),phone:'0555000000',title:'SYNTHETIC'};
 sql({sql:"INSERT INTO sites(id,user_id,draft,status,created_at,updated_at) VALUES(?,?,?,'draft',?,?)",params:[site,actors.member.id,JSON.stringify(profile),now(),now()]});
 sql({sql:'INSERT INTO dns_names(name,owner_id,site_id,created_at) VALUES(?,?,?,?)',params:['synthetic',actors.member.id,site,now()]});
 const objects=new Map<string,{bytes:Uint8Array;customMetadata:any}>();let puts=0,purges=0;
 const env:any={ROOT_DOMAIN:'ksa.men',AUTH_SECRET:'SYNTHETIC-AUTH',BACKUP_ENCRYPTION_KEY:'SYNTHETIC-BACKUP-NOT-LIVE',DB:{prepare:(q:string)=>new Statement(q),batch:async(rows:Statement[])=>sql({batch:rows.map(s=>({sql:s.query,params:s.params}))})},MEDIA:{put:async(key:string,bytes:Uint8Array,options:any)=>{puts++;objects.set(key,{bytes:new Uint8Array(bytes),customMetadata:options.customMetadata});},get:async(key:string)=>{const o=objects.get(key);return o?{arrayBuffer:async()=>o.bytes.buffer,body:o.bytes,customMetadata:o.customMetadata}:null;},delete:async()=>{purges++;throw Error('PROBE MUST NEVER DELETE');}},ASSETS:{fetch:async()=>new Response('<html><head></head><body><div id="root"></div></body></html>',{headers:{'Content-Type':'text/html'}})}};
 async function request(path:string,actor?:string,method='GET',body?:any){const headers:any={Origin:'https://ksa.men'};if(actor){headers.Cookie=actors[actor].cookie;headers['X-CSRF-Token']=actors[actor].csrf;}if(body&&!(body instanceof FormData))headers['Content-Type']='application/json';const r=await worker.fetch(new Request('https://ksa.men'+path,{method,headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined}),env,{} as any);return {status:r.status,data:await r.json().catch(()=>null)};}
 return{sql,env,site,actors,request,puts:()=>puts,purges:()=>purges};
}
