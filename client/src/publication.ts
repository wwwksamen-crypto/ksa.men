const labels: Record<string, [string, string]> = {
  draft: ['لم يُرسل للنشر', 'Not submitted for publication'],
  pending: ['بانتظار اعتماد النشر', 'Awaiting publication approval'],
  published: ['منشور', 'Published'],
  suspended: ['موقوف', 'Suspended'],
  hidden: ['مخفي', 'Hidden'],
  archived: ['مؤرشف', 'Archived'],
};

export function publicationLabel(status: unknown, lang: 'ar' | 'en'): string {
  const key = typeof status === 'string' ? status : '';
  const label = labels[key] ?? ['غير منشور', 'Not published'];
  return label[lang === 'ar' ? 0 : 1];
}
