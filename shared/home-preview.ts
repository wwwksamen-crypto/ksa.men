import { managedText } from './managed-text';

/** Presentation only: never changes managed content or a member's profile. */
export function homePreviewDescription(value: unknown, locale: 'ar' | 'en'): string {
  const body = managedText(value);
  const identity = locale === 'ar'
    ? 'منصة رجال المملكة العربية السعودية'
    : 'The platform for men of the Kingdom of Saudi Arabia';
  return body.includes(identity) ? body : `${identity}\n${body}`.trim();
}
