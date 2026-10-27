import React,{createContext,useContext} from 'react';
export interface User{id:number;email:string;name:string;whatsapp:string;role:'owner'|'manager'|'moderator'|'user';status:string;trial_until:number;entitlement_until:number;balance:number;[key:string]:any}
let csrf='';export function setCSRF(v:string){csrf=v;}
export async function api<T=any>(path:string,options:RequestInit={}):Promise<T>{const headers=new Headers(options.headers);if(options.body&&!(options.body instanceof FormData)&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');if(options.method&&options.method!=='GET')headers.set('X-CSRF-Token',csrf);const r=await fetch(path,{...options,headers,credentials:'same-origin',cache:'no-store'});const data:any=await r.json().catch(()=>({error:'تعذر قراءة الاستجابة'}));if(!r.ok)throw new Error(data.error||data.message||'تعذر تنفيذ الطلب');return data;}
export const AppContext=createContext<{user:User|null,lang:'ar'|'en',t:(ar:string,en:string)=>string,refresh:()=>Promise<void>,notify:(message:string)=>void}>({user:null,lang:'ar',t:a=>a,refresh:async()=>{},notify:()=>{}});
export const useApp=()=>useContext(AppContext);
export function Button({children,className='',...props}:React.ButtonHTMLAttributes<HTMLButtonElement>){return <button {...props} className={'button '+className}>{children}</button>;}
export const json=(v:any)=>JSON.stringify(v);
export const fmtDate=(epoch:number,lang='ar')=>new Date(epoch*1000).toLocaleDateString(lang==='ar'?'ar-SA':'en-GB');
