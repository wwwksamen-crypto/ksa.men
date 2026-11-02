import { describe, expect, it } from 'vitest';
import { publicationLabel } from '../client/src/publication';

describe('publication state labels', () => {
  it('does not describe an unsubmitted site as suspended or pending', () => {
    expect(publicationLabel('draft', 'ar')).toBe('لم يُرسل للنشر');
    expect(publicationLabel('pending', 'ar')).toBe('بانتظار اعتماد النشر');
    expect(publicationLabel('published', 'ar')).toBe('منشور');
    expect(publicationLabel('suspended', 'ar')).toBe('موقوف');
    expect(publicationLabel('draft', 'en')).toBe('Not submitted for publication');
    expect(publicationLabel(undefined, 'en')).toBe('Not published');
  });
});
