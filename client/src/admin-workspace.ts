export type AdminWorkspace = 'overview' | 'requests' | 'accounts' | 'platform' | 'records';
export const adminWorkspaces: { id: AdminWorkspace; ar: string; en: string; tabs: string[] }[] = [
  { id: 'overview', ar: 'المتابعة', en: 'Overview', tabs: ['overview'] },
  { id: 'requests', ar: 'الطلبات', en: 'Requests', tabs: ['reviews', 'membership', 'payments'] },
  { id: 'accounts', ar: 'الحسابات', en: 'Accounts', tabs: ['users', 'managed'] },
  { id: 'platform', ar: 'المنصة', en: 'Platform', tabs: ['content', 'services', 'names', 'redirects', 'lock', 'pricing'] },
  { id: 'records', ar: 'السجل', en: 'Records', tabs: ['audit', 'governance', 'backup', 'economics'] },
];
export function adminWorkspace(tab: string): AdminWorkspace {
  return adminWorkspaces.find(group => group.tabs.includes(tab))?.id ?? 'overview';
}
export function initialAdminTab(search: string, permitted: readonly string[]): string {
  const candidate = new URLSearchParams(search).get('tab');
  return candidate && permitted.includes(candidate) ? candidate : 'overview';
}
