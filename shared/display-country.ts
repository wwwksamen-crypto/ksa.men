export function displayCountry(value: unknown, locale: 'ar' | 'en'): string {
  if (typeof value !== 'string') return '';
  if (/^(?:Saudi Arabia|Kingdom of Saudi Arabia|KSA|السعودية|المملكة العربية السعودية)$/i.test(value.trim())) {
    return locale === 'ar' ? 'المملكة العربية السعودية' : 'Saudi Arabia';
  }
  return value;
}
