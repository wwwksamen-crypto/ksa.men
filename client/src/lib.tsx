import React,{createContext,useContext} from 'react';
export interface User{id:number;email:string;name:string;whatsapp:string;role:'owner'|'manager'|'moderator'|'user';status:string;trial_until:number;entitlement_until:number;balance:number;[key:string]:any}
let csrf='';
export function setCSRF(value:string){csrf=value;}
export class APIError extends Error {
  status:number;
  code:string;
  constructor(message:string,status:number,code=''){super(message);this.name='APIError';this.status=status;this.code=code;}
}
const errorText:Record<string,[string,string]>={
  INVALID_INPUT:['تحقق من الحقول المدخلة وأكمل البيانات المطلوبة.','Check the fields and complete the required information.'],
  INVALID_BODY:['تعذر قراءة الطلب. أعد المحاولة.','The request could not be read. Please retry.'],
  INVALID_MESSAGE:['تحقق من نص الرسالة والرموز المسموح بها.','Check the message text and allowed emoji.'],
  SCOPE_DENIED:['هذا الإجراء خارج نطاق المواقع المسندة إليك.','This action is outside your assigned sites.'],
  FORBIDDEN:['ليست لديك صلاحية لهذا الإجراء.','You are not authorized for this action.'],
  REVIEWER_SUBMITTER_CONFLICT:['يراجع مشرف آخر هذه اللقطة؛ لا يمكن اعتماد طلبك بنفسك.','Another reviewer must review this snapshot. You cannot approve your own submission.'],
  IDEMPOTENCY_CONFLICT:['تغيّرت بيانات العملية. تحقق من النتيجة السابقة قبل إنشاء عملية جديدة.','The operation data changed. Check the previous result before starting another operation.'],
  TRANSFER_PENDING:['يوجد طلب نقل قائم لهذا الاسم.','This name already has a pending transfer.'],
  NAME_TAKEN:['هذا الاسم محجوز بالفعل. اختر اسمًا آخر.','This name is already taken. Choose another.'],
  NAME_RESERVED:['الاسم مخصص لخدمة تقنية أو سياسة المنصة.','This name is reserved for a platform service or policy.'],
  INVALID_NAME:['استخدم حروفًا إنجليزية وأرقامًا وشرطات داخل الاسم، من ١ إلى ٦٣ حرفًا.','Use 1–63 English letters, digits and internal hyphens.'],
  BANK_INTAKE_INACTIVE:['استقبال الحوالات غير متاح حاليًا.','Bank transfer intake is currently unavailable.'],
  STALE_REVIEW:['نُشرت نسخة أحدث. يلزم إرسال لقطة جديدة للمراجعة.','A newer version was published. Submit a new snapshot for review.'],
  INSUFFICIENT_BALANCE:['رصيد النقاط لا يكفي لهذه العملية.','There are not enough points for this operation.'],
};
function readableError(data:any,status:number){
  const english=localStorage.getItem('ksa-lang')==='en';
  const code=String(data.code||'').toUpperCase();
  if(errorText[code])return errorText[code][english?1:0];
  const message=String(data.error||data.message||'');
  if(!english&&message&&!/[\u0600-\u06ff]/.test(message)){
    if(/fresh|reauth|verify.*email/i.test(message))return 'أعد التحقق من البريد لإتمام الإجراء الحساس.';
    if(status===403)return 'ليست لديك صلاحية لهذا الإجراء.';
    if(status===409)return 'تغيّرت الحالة أو نُفذت العملية سابقًا. حدّث البيانات قبل المتابعة.';
    if(status===410)return 'انتهت صلاحية هذه الجلسة أو الخدمة.';
    if(status===400)return 'تحقق من البيانات المدخلة وأعد المحاولة.';
  }
  return message||(english?'The request could not be completed.':'تعذر تنفيذ الطلب.');
}
export async function api<T=any>(path:string,options:RequestInit={}):Promise<T>{
  const headers=new Headers(options.headers);
  if(options.body&&!(options.body instanceof FormData)&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');
  if(options.method&&options.method!=='GET')headers.set('X-CSRF-Token',csrf);
  const response=await fetch(path,{...options,headers,credentials:'same-origin',cache:'no-store'});
  const data:any=await response.json().catch(()=>({error:'تعذر قراءة الاستجابة'}));
  if(!response.ok)throw new APIError(readableError(data,response.status),response.status,String(data.code||''));
  return data;
}
export const AppContext=createContext<{user:User|null,lang:'ar'|'en',t:(ar:string,en:string)=>string,refresh:()=>Promise<void>,notify:(message:string)=>void}>({user:null,lang:'ar',t:a=>a,refresh:async()=>{},notify:()=>{}});
export const useApp=()=>useContext(AppContext);
export function Button({children,className='',...props}:React.ButtonHTMLAttributes<HTMLButtonElement>){return <button {...props} className={'button '+className}>{children}</button>;}
export const json=(value:any)=>JSON.stringify(value);
export const fmtDate=(epoch:number,lang='ar')=>new Date(epoch*1000).toLocaleDateString(lang==='ar'?'ar-SA':'en-GB');
