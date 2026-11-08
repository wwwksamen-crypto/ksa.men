export const institutionalContact = {
  support: 'support@ksa.men',
  executive: 'ceo@ksa.men',
  sender: 'KSA.MEN <support@ksa.men>',
} as const;
export function publicInstitutionalContact(value: unknown) {
  const previous = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return { ...previous, email: institutionalContact.support, executiveEmail: institutionalContact.executive };
}
