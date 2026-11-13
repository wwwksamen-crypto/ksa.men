import { useRef, useState } from 'react';
import { Trash2, RefreshCw } from 'lucide-react';
import { api, useApp } from './lib';
import './request-removal.css';

export default function RequestRemovalButton({ kind, requestId, status, onRemoved }: {
  kind: 'review' | 'membership'; requestId: string; status: string; onRemoved: () => void;
}) {
  const { t, notify } = useApp();
  const [open, setOpen] = useState(false), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const acting = useRef(false);
  async function remove() {
    if (!reason.trim() || acting.current) return;
    acting.current = true; setBusy(true); setError('');
    try {
      const result = await api<{ removed: boolean; proofId: string; auditPending?: boolean }>(
        `/api/admin/request-removals/${kind}/${encodeURIComponent(requestId)}`,
        { method: 'POST', body: JSON.stringify({ reason: reason.trim(), expectedStatus: status }) },
      );
      if (!result.removed) throw new Error(t('لم يتأكد حذف الطلب.', 'Request removal was not confirmed.'));
      notify(result.auditPending
        ? t('حُذف الطلب وحُفظ إثباته؛ راجع السجل لإكمال حدث التدقيق.', 'Request removed and evidence saved; review the audit completion.')
        : t('حُذف الطلب من القائمة وحُفظ السبب والمنفذ في السجل.', 'Request removed from the list; reason and actor recorded.'));
      onRemoved();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      setError(message); notify(message);
    } finally { acting.current = false; setBusy(false); }
  }
  return <section className="request-removal">
    <button type="button" className="button button-small button-quiet" aria-expanded={open} disabled={busy} onClick={() => {
      setOpen(!open); notify(open ? t('أُغلقت خيارات حذف الطلب.', 'Request removal closed.') : t('اكتب سبب حذف الطلب ثم نفّذ القرار.', 'Enter the reason, then execute removal.'));
    }}><Trash2 size={16}/>{t('حذف الطلب', 'Delete request')}</button>
    {open && <div className="request-removal__form">
      <label>{t('سبب حذف الطلب', 'Reason for deleting the request')}
        <textarea dir="auto" rows={2} maxLength={1000} required disabled={busy} value={reason} onChange={event => setReason(event.target.value)}/>
      </label>
      <p className="muted">{t('يخرج الطلب من قائمة العمل ويُسجل القرار. لا يُحذف المستخدم أو الموقع ولا تُلغى عضوية سبق اعتمادها.', 'The request leaves the work list and the decision is recorded. The user, website and previously approved membership remain.')}</p>
      <button type="button" className="button button-danger" aria-busy={busy} disabled={busy || !reason.trim()} onClick={() => void remove()}>
        {busy ? <RefreshCw size={16} className="spin"/> : <Trash2 size={16}/>}{busy ? t('جارٍ حذف الطلب…', 'Removing request…') : t('حذف الطلب وتسجيل السبب', 'Delete request and record reason')}
      </button>
      {error && <p role="alert" className="error">{error}</p>}
    </div>}
  </section>;
}
