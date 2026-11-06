import { Download, ShieldCheck } from 'lucide-react';
import { businessApproach } from '../../shared/business-approach';
import { useApp } from './lib';

export default function BusinessApproach() {
  const { lang } = useApp();
  const copy = businessApproach.copy[lang];
  return <section className="section card business-approach" aria-labelledby="business-approach-heading">
    <div className="business-approach__heading"><ShieldCheck size={28} aria-hidden="true"/><h2 id="business-approach-heading">{copy.title}</h2></div>
    <p>{copy.description}</p>
    <p className="muted">{copy.version}</p>
    <nav aria-label={copy.title} className="business-approach__downloads">
      {(['ar', 'en'] as const).map(locale => <a key={locale} className="button secondary" href={businessApproach.documents[locale].path} download={businessApproach.documents[locale].filename}><Download size={18} aria-hidden="true"/>{locale === 'ar' ? copy.arabic : copy.english}</a>)}
    </nav>
  </section>;
}
