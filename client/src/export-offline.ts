export function canRestorePublishedBadge(kind: string, publishedSource: boolean, online: boolean, error: unknown): boolean {
  const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
  return kind === 'badge' && publishedSource && online === false && !status;
}
export function readPublishedBadge(raw: string | null, name: string, currentTime = Date.now()) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw), data = parsed?.data;
    if (typeof parsed.savedAt !== 'number' || parsed.savedAt > currentTime + 60_000 || currentTime - parsed.savedAt > 24 * 3600_000) return null;
    if (!data || data.source !== 'published' || data.name !== name || data.allowed !== true || typeof data.translated !== 'boolean' || typeof data.site !== 'string' || !data.profile || typeof data.profile !== 'object' || Array.isArray(data.profile)) return null;
    return data as { name: string; profile: Record<string, unknown>; source: 'published'; allowed: boolean; translated: boolean; site: string };
  } catch { return null; }
}
