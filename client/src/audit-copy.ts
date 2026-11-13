type Translate = (ar: string, en: string) => string;
const labels: Record<string, [string,string]> = {
 'admin.request.requested':['طلب حذف من القائمة','Request removal requested'],
 'admin.request.completed':['حذف طلب من قائمة العمل','Request removed from work list'],
 'admin.request.blocked':['حذف طلب ممنوع بحصانة','Request removal blocked by protection'],
 'admin.request.conflict':['حذف طلب توقف لتغير حالته','Request removal stopped after state changed'],
 'owner.erasure.requested':['طلب حذف نهائي','Permanent deletion requested'],
 'owner.erasure.reviewed':['مراجعة أثر الحذف','Deletion impact reviewed'],
 'owner.erasure.completed':['تنفيذ الحذف النهائي','Permanent deletion executed'],
 'owner.erasure.blocked':['حذف ممنوع بحصانة','Deletion blocked by protection'],
 'owner.erasure.conflict':['حذف متوقف لتغير البيانات','Deletion stopped after data changed'],
 'owner.erasure.failed':['إخفاق تنفيذ الحذف','Deletion failed'],
 'owner.erasure.invalid':['تأكيد حذف غير مكتمل','Incomplete deletion confirmation'],
 'owner.erasure.denied':['محاولة حذف بلا صلاحية','Unauthorized deletion attempt'],
 'owner.erasure.repeated':['تكرار طلب حذف منفذ','Repeated completed deletion'],
 'user.status':['تغيير حالة الحساب','Account status changed'], 'user.role':['تعديل الصلاحية','Role changed'],
 'user.assign':['إسناد مشرف','Administrator assigned'], 'user.points':['إضافة نقاط','Points issued'],
 'audit.verify':['فحص سلامة السجل','Audit integrity checked'],
};
export function auditActionLabel(action: string,t:Translate):string {
 const label=labels[action]; if(label)return t(...label);
 if(/publish|publication|review/.test(action))return t('إجراء نشر أو مراجعة','Publication or review action');
 if(/payment|subscription|entitlement|membership/.test(action))return t('إجراء عضوية أو سداد','Membership or payment action');
 if(/lock/.test(action))return t('تعديل قفل المنصة','Platform lock changed');
 if(/content|setting|service/.test(action))return t('تعديل محتوى أو إعداد','Content or setting changed');
 if(/backup/.test(action))return t('إجراء نسخة احتياطية','Backup action');
 if(/auth|session|device/.test(action))return t('إجراء دخول أو جلسة','Sign-in or session action');
 return t('إجراء مسجل','Recorded action');
}
export function auditOutcomeLabel(action:string,t:Translate):string {
 if(/blocked|denied|invalid/.test(action))return t('لم يُنفذ — مرفوض','Not executed — rejected');
 if(/conflict/.test(action))return t('لم يُنفذ — بيانات متغيرة','Not executed — data changed');
 if(/failed/.test(action))return t('إخفاق — راجع الإثبات','Failed — review evidence');
 if(/requested|reviewed/.test(action))return t('طلب أو مراجعة — ليس تنفيذ حذف','Request or review — not deletion');
 if(/repeated/.test(action))return t('منفذ سابقاً — دون أثر جديد','Already executed — no new effect');
 if(/completed/.test(action))return t('تم التنفيذ','Executed');
 return t('راجع تفاصيل القرار','Review decision details');
}
