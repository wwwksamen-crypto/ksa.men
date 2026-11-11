export type MemberTab = 'editor' | 'services' | 'wallet' | 'messages' | 'subscription' | 'settings';
export type MemberSection = 'site' | 'outputs' | 'account';
export type MemberWorkspace = 'overview' | 'create' | 'edit';
export type CreationStep = 'address' | 'basics' | 'review';

export function memberSection(tab: MemberTab): MemberSection {
  return tab === 'editor' ? 'site' : tab === 'services' ? 'outputs' : 'account';
}

/** Existing URLs and server dashboard views remain the source of truth. */
export function memberWorkspace(site: { status?: string; published_version?: number; published?: unknown }, editRequested = false): MemberWorkspace {
  if (editRequested) return 'edit';
  if (site.status === 'draft' && !site.published_version && !site.published) return 'create';
  return 'overview';
}

export function editRequested(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.get('mode') === 'edit' || Boolean(params.get('site')?.trim());
}
