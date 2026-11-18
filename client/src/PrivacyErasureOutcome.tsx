import {useApp} from './lib';
import {erasureScopeLabel,erasureMediaLabel,type PrivacyErasureOutcome as Outcome} from '../../shared/privacy-rights';
export default function PrivacyErasureOutcome({outcome}:{outcome?:Outcome|null}){
 const {t}=useApp();if(!outcome)return null;
 return <section className="privacy-request stack" aria-label={t('نتيجة طلب الإزالة','Removal request outcome')}>
  <strong>{outcome.operationRecorded?erasureScopeLabel(outcome.scope,t):t('نتيجة الإزالة تحتاج تحققاً','Removal outcome requires verification')}</strong>
  <p>{erasureMediaLabel(outcome.media.state,t)}</p>
  {outcome.media.total>0&&<p>{t('الوسائط المسجلة','Recorded media')}: {outcome.media.total} · {t('مكتملة بالسجل','Recorded as removed')}: {outcome.media.removed} · {t('تحتاج متابعة','Needs follow-up')}: {outcome.media.pending+outcome.media.failed}</p>}
  <p>{t('سجلات محددة ما زالت محتفظاً بها؛ هذه نتيجة للنطاق الموضح وليست إثبات محو جميع البيانات والنسخ.','Specific records remain retained. This is the stated scope outcome, not proof that all data and backups were erased.')}</p>
 </section>;
}
