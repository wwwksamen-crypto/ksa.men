import type { ReactNode } from 'react';
import { ArrowRight, Check, Eye, FileCheck2, PencilLine, RefreshCw, Save } from 'lucide-react';
import { DictatedInput, DictatedTextarea } from './DictatedField';
import type { ProfileDraft } from './Dashboard';
import type { CreationStep } from './member-journey';
import './member-journey.css';

type Translate = (ar: string, en: string) => string;

export function CreationSteps({ step, tr }: { step: CreationStep; tr: Translate }) {
  const steps = [
    ['address', 'عنوان موقعك', 'Your address'],
    ['basics', 'عرّف بنفسك', 'Introduce yourself'],
    ['review', 'راجع واطلب النشر', 'Preview and submit'],
  ] as const;
  const selected = steps.findIndex(([key]) => key === step);
  return <ol className="member-creation-steps" aria-label={tr('مراحل إنشاء موقعك', 'Site creation stages')}>
    {steps.map(([key, ar, en], index) => <li key={key} className={index < selected ? 'is-done' : key === step ? 'is-current' : ''} aria-current={key === step ? 'step' : undefined}>
      <span className="member-creation-steps__number" aria-hidden="true">{index < selected ? <Check size={15}/> : index + 1}</span><span>{tr(ar, en)}</span>
    </li>)}
  </ol>;
}

export function MemberBasics({ draft, lang, tr, onChange, onPreview, onEdit, onSave, saving, busy, optionalMedia, error, fallbackName }: {
  draft: ProfileDraft; lang: 'ar' | 'en'; tr: Translate;
  onChange: (patch: Partial<ProfileDraft>) => void; onPreview: () => void; onEdit: () => void; onSave: () => void;
  saving: boolean; busy: boolean; optionalMedia: ReactNode; error: string; fallbackName?: string;
}) {
  return <section className="member-basics card" aria-labelledby="member-basics-title">
    <CreationSteps step="basics" tr={tr}/>
    <header><p className="dashboard-kicker">{tr('خطوة بخطوة', 'One step at a time')}</p><h2 id="member-basics-title">{tr('عرّف بنفسك', 'Introduce yourself')}</h2><p className="muted">{tr('ابدأ بتعريف مختصر، وأضف بقية التفاصيل عندما ترغب. لا يلزم إكمال كل الأقسام لطلب النشر.', 'Start with a short introduction. Add more whenever you wish; completing every section is not required to request publication.')}</p></header>
    <div className="dashboard-settings-grid">
      <div><DictatedInput label={tr('الاسم', 'Name')} autoComplete="name" maxLength={160} value={draft.name} onChange={name => onChange({ name })} lang={lang} tr={tr}/>{!draft.name.trim() && fallbackName && <small className="member-field-hint" dir="auto">{tr(`إذا تركته فارغاً، يستخدم النشر اسم حسابك: ${fallbackName}.`, `If left empty, publication uses your account name: ${fallbackName}.`)}</small>}</div>
      <DictatedInput label={tr('المسمى المهني', 'Professional title')} maxLength={180} value={draft.title} onChange={title => onChange({ title })} placeholder={tr('اختياري', 'Optional')} lang={lang} tr={tr}/>
      <DictatedInput label={tr('التخصص', 'Specialty')} maxLength={120} value={draft.specialty} onChange={specialty => onChange({ specialty })} placeholder={tr('اختياري — مثال: التسويق', 'Optional — e.g. Marketing')} lang={lang} tr={tr}/>
      <DictatedInput label={tr('المدينة', 'City')} autoComplete="address-level2" maxLength={120} value={draft.city} onChange={city => onChange({ city })} placeholder={tr('اختياري', 'Optional')} lang={lang} tr={tr}/>
    </div>
    <DictatedTextarea label={tr('نبذة قصيرة', 'A short introduction')} rows={4} maxLength={5000} value={draft.bio} onChange={bio => onChange({ bio })} placeholder={tr('اختياري — ما الذي تريد أن يعرفه الزائر عنك؟', 'Optional — what would you like visitors to know about you?')} lang={lang} tr={tr}/>
    <details className="member-optional-media"><summary>{tr('الصورة والغلاف — اختياري', 'Photo and cover — optional')}</summary>{optionalMedia}</details>
    {error && <p className="dashboard-error" role="alert">{error}</p>}
    <div className="member-journey-actions dashboard-editor-actions">
      <button type="button" className="button" disabled={busy} onClick={onPreview}>{busy ? <RefreshCw size={17} className="spin"/> : <Eye size={17}/>} {tr('عاين موقعي', 'Preview my site')}</button>
      <button type="button" className="button button--quiet" onClick={onSave} disabled={busy || saving}><Save size={17}/>{saving ? tr('جارٍ الحفظ', 'Saving') : tr('حفظ', 'Save')}</button>
    </div>
    <button className="member-text-action" type="button" disabled={busy} onClick={onEdit}><PencilLine size={15}/>{tr('إضافة خبرات وشواهد وتفاصيل أخرى', 'Add experience, evidence and more')}</button>
  </section>;
}

export function MemberSiteOverview({ name, title, status, message, tr, onEdit, onPreview, onSubmit, onOutputs, busy, creationReview = false, error }: {
  name: string; title: string; status: string; message?: string; tr: Translate;
  onEdit: () => void; onPreview: () => void; onSubmit: () => void; onOutputs: () => void;
  busy: boolean; creationReview?: boolean; error?: string;
}) {
  return <section className="member-site-overview card">
    {creationReview && <CreationSteps step="review" tr={tr}/>}
    <div className="member-site-overview__heading"><div><p className="dashboard-kicker">{creationReview ? tr('الخطوة الأخيرة', 'The last step') : tr('موقعك في مكان واحد', 'Your site, in one place')}</p><h2 dir="auto">{creationReview ? tr('راجع واطلب النشر', 'Preview and request publication') : name || tr('موقعي', 'My site')}</h2>{!creationReview && title && <p className="muted" dir="auto">{title}</p>}</div><span className="dashboard-status">{status}</span></div>
    <p className="muted">{creationReview ? tr('هذه معاينة لمسودتك الحالية. اطلب النشر عندما ترغب؛ لا تصبح التعديلات عامة إلا بعد الاعتماد.', 'This is your current draft preview. Submit when you wish; changes become public only after approval.') : tr('عدّل ما ترغب، وشاهد موقعك قبل إرسال أحدث نسخة للمراجعة.', 'Edit what you wish, preview your site, then submit your latest version for review.')}</p>
    <div className="member-journey-actions" role="group" aria-label={tr('إجراءات موقعي', 'My site actions')}>
      <button type="button" className="button button--quiet" onClick={onEdit} disabled={busy}><PencilLine size={17}/>{tr('تعديل', 'Edit')}</button>
      <button type="button" className="button button--quiet" onClick={onPreview} disabled={busy}><Eye size={17}/>{tr('معاينة', 'Preview')}</button>
      <button type="button" className="button" onClick={onSubmit} disabled={busy}>{busy ? <RefreshCw className="spin" size={17}/> : <FileCheck2 size={17}/>} {tr('طلب نشر موقعي', 'Request publication')}</button>
    </div>
    {error && <p className="dashboard-error" role="alert">{error}</p>}
    {message && <div className="dashboard-submission-status" role="status"><p>{message}</p></div>}
    {!creationReview && <button type="button" className="member-text-action" onClick={onOutputs}><ArrowRight size={15}/>{tr('المخرجات وخدمات موقعك', 'Site outputs and services')}</button>}
  </section>;
}
