export function normalizeSubdomain(value: unknown, root = 'ksa.men'): string {
  if (typeof value !== 'string') throw new Error('أدخل اسم الموقع أو رابطه الكامل');
  let name = value.trim().toLowerCase();
  if (/^https?:\/\//.test(name)) {
    const url = new URL(name);
    if (url.username || url.password || url.port || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) throw new Error('أدخل اسم الموقع دون مسار أو إضافات');
    name = url.hostname;
  }
  if (name.endsWith('.' + root)) name = name.slice(0, -(root.length + 1));
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name)) throw new Error('اختر اسماً من الحروف الإنجليزية والأرقام والشرطة الداخلية، حتى 63 حرفاً');
  return name;
}
export function safeRedirectTarget(value: unknown, sourceName: string, root = 'ksa.men'): string {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('أدخل رابط HTTPS صالحاً');
  let url: URL; try { url = new URL(value.trim()); } catch { throw new Error('أدخل رابطاً كاملاً يبدأ بـ https://'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !host.includes('.') || /[\[\]:]/.test(host) || /^\d+(?:\.\d+){3}$/.test(host) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host) || host === sourceName + '.' + root) throw new Error('الوجهة غير صالحة أو تعيد إلى الرابط نفسه');
  return url.href;
}
