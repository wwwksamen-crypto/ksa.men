export type PrivacyRequestType = 'export' | 'correction' | 'erasure' | 'objection';
export type PrivacyStatus = 'received' | 'processing' | 'ready' | 'reviewing' | 'answered' | 'blocked' | 'rejected' | 'failed' | 'expired' | 'cancelled';
export type PrivacyRequest = {
  id:string; type:PrivacyRequestType; status:PrivacyStatus; createdAt:number; updatedAt:number; dueAt:number;
  response:string; expiresAt?:number|null; downloadable:boolean;
};
export type PrivacyEvent = {status:PrivacyStatus;code:string;createdAt:number};
export type PrivacyConsent = {id:string;purpose:string;noticeVersion:string;grantedAt:number;withdrawnAt:number|null};
export type PrivacySummary = {enabled:boolean;policyVersion:string|null;requests:PrivacyRequest[];consents:PrivacyConsent[];nextBefore?:string|null};
export function privacyTypeLabel(type:string,t:(ar:string,en:string)=>string) {
  const labels:Record<string,[string,string]>={export:['نسخة بياناتي','My data copy'],correction:['تصحيح بيانات','Data correction'],erasure:['طلب إزالة بيانات','Data removal request'],objection:['تقييد معالجة بيانات','Restrict data processing']};
  return labels[type]?t(...labels[type]):t('طلب بيانات','Data request');
}
export function privacyStatusLabel(status:string,t:(ar:string,en:string)=>string) {
  const labels:Record<string,[string,string]>={received:['استلمنا طلبك','Request received'],processing:['جارٍ تجهيز نسختك','Preparing your copy'],ready:['النسخة جاهزة','Copy ready'],reviewing:['قيد المراجعة','Under review'],answered:['وصل الرد على طلبك','Response available'],blocked:['تحتاج متابعة','Follow-up required'],rejected:['ورد قرار موضح بالرد','Decision explained in response'],failed:['تعذر التجهيز؛ طلبك محفوظ','Preparation failed; request retained'],expired:['انتهت مهلة التنزيل','Download period ended'],cancelled:['توقفت متابعة هذا الطلب','Request no longer active']};
  return labels[status]?t(...labels[status]):t('راجع تفاصيل الطلب','Review request details');
}
export function consentPurposeLabel(purpose:string,t:(ar:string,en:string)=>string) {
  const labels:Record<string,[string,string]>={account_creation:['إنشاء الحساب','Account creation'],public_profile:['نشر موقعي للعامة','Public profile publication'],contact:['طلبات التواصل','Contact requests'],translation:['ترجمة نصوصي','Text translation'],seasonal_notices:['تنبيهات المناسبات','Seasonal notices']};
  return labels[purpose]?t(...labels[purpose]):t('غرض معالجة مسجل','Recorded processing purpose');
}

export type PrivacyErasureOutcome = {
 scope:'account'|'account_only'|'site';operationRecorded:boolean;executedAt:number;
 recordsRetained:true;fullErasureVerified:false;
 media:{total:number;removed:number;failed:number;pending:number;state:'retained'|'incomplete'|'pending'|'verified'};
};
export function erasureScopeLabel(scope:string,t:(ar:string,en:string)=>string){
 return scope==='account_only'?t('إزالة الحساب مع إبقاء المواقع','Account removed; sites retained'):scope==='site'?t('إزالة موقع محدد','Specific site removed'):t('إزالة الحساب ومواقعه','Account and sites removed');
}
export function erasureMediaLabel(state:string,t:(ar:string,en:string)=>string){
 return state==='retained'?t('صور المواقع المحتفظ بها باقية','Retained site images remain'):state==='verified'?t('سجل إزالة الوسائط المحددة مكتمل','Scoped media removal records complete'):state==='pending'?t('إزالة الوسائط المحددة قيد المتابعة','Scoped media removal requires follow-up'):t('اكتمال إزالة الوسائط غير مثبت','Media removal completeness not verified');
}
