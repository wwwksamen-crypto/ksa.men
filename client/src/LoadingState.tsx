import { useApp } from './lib';
import './loading.css';
export default function LoadingState({ compact = false }: { compact?: boolean }) {
 const { t }=useApp();
 return <div className={`brand-loading${compact?' brand-loading--compact':''}`} role="status" aria-live="polite"><img src="/assets/logo-emblem.webp" alt="" width="64" height="64" decoding="async"/><span>{t('نجهّز مساحتك…','Preparing your space…')}</span></div>;
}
