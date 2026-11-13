import type { MouseEvent } from 'react';
export function memberActionFeedback(event: MouseEvent<HTMLElement>, notify: (message: string) => void, t: (ar: string, en: string) => string) {
  const source = event.target as Element;
  if (!source?.closest) return;
  const summary = source.closest('summary');
  const local = source.closest<HTMLButtonElement>('button[data-local-action]');
  if (summary) {
    const details = summary.parentElement as HTMLDetailsElement;
    const label = summary.textContent?.trim().replace(/\s+/g,' ').slice(0,100) || '';
    requestAnimationFrame(() => { if (details?.isConnected) notify(details.open ? t(`تم فتح: ${label}`, `Opened: ${label}`) : t(`تم إغلاق: ${label}`, `Closed: ${label}`)); });
  } else if (local && !local.disabled) {
    const action = local.dataset.localAction;
    const host = event.currentTarget;
    requestAnimationFrame(() => { if (host.isConnected) notify(action === 'add' ? t('أضيف عنصر إلى المسودة؛ يمكنك تعبئته الآن.', 'An item was added to the draft; you can fill it in now.') : t('أزيل العنصر من المسودة.', 'The item was removed from the draft.')); });
  }
}
