import type { SanadContextState, SanadSection } from './sanad-context';
export type SanadAction = 'member-edit' | 'member-preview' | 'member-outputs' | 'member-account' | 'admin-requests' | 'admin-accounts' | 'admin-records';
export const SANAD_ACTION_EVENT = 'ksa:sanad-action';
export type SanadLink = { action?: SanadAction; href?: string; ar: string; en: string };
export function sanadLinks(section: SanadSection, context: SanadContextState): SanadLink[] {
  if(section==='admin') return [
    {action:'admin-requests', ar:'افتح الطلبات', en:'Open requests'},
    {action:'admin-accounts', ar:'افتح الحسابات', en:'Open accounts'},
    ...(context.state==='owner'?[{action:'admin-records' as const,ar:'افتح السجل',en:'Open record'}]:[]),
  ];
  if(['editor','review','outputs','account','wallet'].includes(section)) return [
    {action:'member-edit',ar:context.state==='creating-address'?'اختر عنوان موقعي':'افتح محرر موقعي',en:context.state==='creating-address'?'Choose my site address':'Open my site editor'},
    ...(context.state!=='creating-address'?[{action:'member-preview' as const,ar:'عاين موقعي',en:'Preview my site'}]:[]),
    {action:'member-outputs',ar:'افتح مخرجاتي',en:'Open my downloads'},
  ];
  if(section==='qr')return [{href:'/features',ar:'استكشف المزايا',en:'Explore features'}];
  return [{href:'/start?register=1',ar:'ابدأ موقعي',en:'Start my site'}, {href:'/login',ar:'ادخل حسابي',en:'Sign in'}];
}
export function journeyGuidance(context:SanadContextState):{ar:string;en:string}|null {
  if(context.error)return {ar:'لم يكتمل آخر إجراء. بقي عملك هنا؛ راجع التنبيه في الصفحة ثم حاول مجدداً.',en:'The last action did not finish. Your work remains here; review the page alert and retry.'};
  const steps:Record<string,{ar:string;en:string}>={
    'creating-address':{ar:'اختر عنواناً متاحاً لموقعك، ثم انتقل إلى تعريف مختصر بنفسك.',en:'Choose an available site address, then introduce yourself briefly.'},
    'creating-basics':{ar:'ابدأ بتعريف مختصر. الصورة والمسمى والنبذة اختيارية؛ يمكنك إضافة التفاصيل لاحقاً ثم معاينة موقعك.',en:'Start with a brief introduction. Photo, title and bio are optional; add more later, then preview your site.'},
    'creating-review':{ar:'هذه معاينة موقعك. إذا أعجبتك، اضغط طلب النشر من الصفحة؛ وإلا ارجع للتعديل.',en:'This is your site preview. Submit it for publication from the page when ready, or return to edit.'},
    overview:{ar:['review','pending'].includes(context.reviewStatus)?'موقعك ينتظر مراجعة المشرف. تستطيع معاينته ومواصلة تعديل المسودة دون تغيير الطلب المرسل.':'موقعك في مكان واحد: عدّل بياناتك، عاين النتيجة، ثم اطلب نشر ما اخترت مشاركته.',en:['review','pending'].includes(context.reviewStatus)?'Your site is awaiting review. Preview it or continue editing the draft without changing the submitted request.':'Your site in one place: edit, preview, then request publication of what you choose to share.'},
    outputs:{ar:'مخرجاتك هنا: بروفايل وسيرة وبطاقة ورموز QR. اختر ما تحتاجه، مع بقاء خيارات الخصوصية والاستحقاق.',en:'Find your profile, résumé, badge and QR codes here. Choose what you need, with privacy and entitlement controls retained.'},
    account:{ar:'من حسابي تصل إلى الرسائل والنقاط والعضوية والإعدادات، دون ازدحام محرر موقعك.',en:'Find messages, points, membership and settings in My account, separate from your site editor.'},
  };
  if(context.section==='admin') {
    const admin:Record<string,{ar:string;en:string}>={
      overview:{ar:'ابدأ بالطلبات المنتظرة. الحسابات لإدارة الأعضاء، والمنصة لإعداداتها، والسجل لمراجعة قراراتك.',en:'Start with pending requests. Use Accounts for members, Platform for settings, and Records for decisions.'},
      requests:{ar:'عاين الطلب ثم اعتمد النشر مباشرة، أو اكتب سبب طلب التعديل أو الرفض.',en:'Preview the request, then publish directly or explain a change request or rejection.'},
      accounts:{ar:'افتح بطاقة الحساب لإدارته. حذف موقع أو حساب متاح للمشرف الرئيسي بسبب وملخص أثر وتأكيد نهائي.',en:'Open an account card to manage it. The principal administrator can remove a site or account with a reason, impact review and final confirmation.'},
      platform:{ar:'اختر الإعداد الذي تريد تعديله فقط. تبقى القرارات والصلاحيات موثقة خلف تجربة بسيطة.',en:'Choose only the setting you need to change. Decisions and permissions remain documented behind a simple workflow.'},
      records:{ar:'راجع من نفّذ الإجراء ووقته ونتيجته. سجل الحذف يوضح السبب وإثبات القرار وحالة الملفات.',en:'Review who acted, when and with what result. Deletion records show the reason, evidence and file status.'},
    };
    return admin[context.step]??admin.overview;
  }
  return steps[context.state]??null;
}
