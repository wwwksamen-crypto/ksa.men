import type { Locale, PageSEO } from './seo';

export const quickFields = ['name', 'title', 'phone', 'whatsapp', 'email', 'site'] as const;
export const isShortQuickToken = (id: string) => /^[A-Za-z0-9_-]{16}$/.test(id);
// Old records are preserved, including non-UUID legacy keys. Bound the lookup before touching D1.
export const isQuickToken = (id: string) => /^[A-Za-z0-9_-]{1,80}$/.test(id);
export const isQuickPath = (path: string) => /^\/(q|quick)\/[^/]+$/.test(path);
export const quickURL = (id: string, domain: string) => `https://${domain}/${isShortQuickToken(id) ? 'q' : 'quick'}/${encodeURIComponent(id)}`;

export function quickMetadata(path: string, lang: Locale, domain = 'ksa.men', available = true): PageSEO {
  return {
    title: (lang === 'ar' ? (available ? 'بطاقة تعارف' : 'رابط التعارف غير متاح') : (available ? 'Introduction card' : 'Introduction link unavailable')) + ' — KSA.MEN',
    description: lang === 'ar'
      ? (available ? 'تواصل بثقة. بطاقة تعارف ببيانات يختارها صاحبها ومدة صلاحية محددة.' : 'انتهت صلاحية هذا الرابط أو أوقف صاحبه مشاركته. يمكنك طلب رابط جديد منه.')
      : (available ? 'Connect with confidence. An introduction with owner-selected details and a limited lifetime.' : 'This link has expired or its owner has stopped sharing it. Ask them for a new link.'),
    lang, indexable: false, image: `https://${domain}/assets/share-logo-1200-v1.png`,
    ...(available ? { url: `https://${domain}${path}` + (lang === 'en' ? '?lang=en' : '') } : {}),
  };
}

export function safeQuickSite(value: unknown, domain = 'ksa.men'): string {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    const suffix = '.' + domain;
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !(url.hostname === domain || (url.hostname.endsWith(suffix) && /^[a-z0-9-]+$/.test(url.hostname.slice(0, -suffix.length))))) return '';
    return url.href;
  } catch { return ''; }
}

export function quickPhone(value: string): string {
  const digits = value.replace(/[٠-٩۰-۹]/g, c => String(c.charCodeAt(0) - (c.charCodeAt(0) >= 0x6f0 ? 0x6f0 : 0x660))).replace(/\D/g, '');
  const international = digits.startsWith('00') ? digits.slice(2) : digits;
  return /^05\d{8}$/.test(international) ? '966' + international.slice(1) : /^\d{7,15}$/.test(international) ? international : '';
}
