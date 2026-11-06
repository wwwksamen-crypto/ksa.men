export function referralCode(value: unknown): string {
  if (typeof value !== 'string') return '';
  const code = value.trim();
  const account = /^c([1-9]\d{0,14})$/i.exec(code);
  if (account && Number.isSafeInteger(Number(account[1]))) return 'C' + account[1];
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(code) && !/^c\d+$/i.test(code) ? code.toLowerCase() : '';
}
export function memberReferralCode(id: unknown): string {
  const raw = String(id ?? '').replace(/^c/i, '');
  return /^[1-9]\d{0,14}$/.test(raw) && Number.isSafeInteger(Number(raw)) ? 'C' + raw : '';
}
export function referralURL(id: unknown, rootDomain = 'ksa.men'): string {
  const code = memberReferralCode(id);
  return code ? `https://${rootDomain}/auth?register=1&ref=${encodeURIComponent(code)}` : '';
}
export type ReferralSummary = {
  url: string; code: string; visits: number | null; metricsEnabled?: boolean; registered: number; eligible: number;
  rewarded: number; cancelled: number; pointsIssued: number; pointsRecovered: number;
  pointsOutstanding: number; rewardPoints: number;
};
