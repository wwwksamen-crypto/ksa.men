import { list, record, type ProfileRecord } from './profile-content';
export const listFields = ['experience','education','training','skills','memberships','languages','hobbies','achievements','timeline','skillImages','workImages','socials','buttons','skillRadar.human','skillRadar.scientific','skillRadar.professional'] as const;
export const scalarFields = ['name','title','bio','email','phone','whatsapp','city','country','photo','cover','youtube','blog'] as const;
export const visibilityFields = [...scalarFields, ...listFields, 'skillRadar', 'allowContact'] as const;
export type ItemIds = Record<string, string[]>;
export type VisibilityPolicy = { hidden: string[]; hiddenItems: string[]; visible: boolean; listed: boolean; indexable: boolean; version: number };
export function pathValue(profile: ProfileRecord, path: string): unknown { return path.split('.').reduce<unknown>((value, part) => record(value)[part], profile); }
function setPath(profile: ProfileRecord, path: string, value: unknown) {
  const parts = path.split('.'); let target = profile;
  for (const part of parts.slice(0, -1)) { target[part] = { ...record(target[part]) }; target = target[part] as ProfileRecord; }
  target[parts[parts.length - 1]] = value;
}
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).filter(([key]) => key !== 'id').map(([key, item]) => JSON.stringify(key)+':'+canonical(item)).join(',')}}`; return JSON.stringify(value) ?? ''; }
/** Stable legacy keys identify content, not its position; never used as a security token. */
function legacyKey(value: unknown, occurrence: number) { const source = canonical(value); let a = 2166136261, b = 5381; for (let i = 0; i < source.length; i++) { a = Math.imul(a ^ source.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ source.charCodeAt(i); } return `old_${(a >>> 0).toString(36)}_${(b >>> 0).toString(36)}_${occurrence}`; }
export function profileItemIds(profile: ProfileRecord): ItemIds {
  const given = record(profile.itemIds), output: ItemIds = {};
  for (const field of listFields) {
    const counts = new Map<string, number>(), used = new Set<string>();
    output[field] = list(pathValue(profile, field)).map((value, index) => {
      const canonicalValue = canonical(value), occurrence = counts.get(canonicalValue) || 0; counts.set(canonicalValue, occurrence + 1);
      const candidate = Array.isArray(given[field]) ? given[field][index] : undefined;
      const id = typeof candidate === 'string' && /^[A-Za-z\d_-]{1,80}$/.test(candidate) && !used.has(candidate) ? candidate : legacyKey(value, occurrence);
      used.add(id); return id;
    });
  }
  return output;
}
export function reconcileItemIds(previous: ProfileRecord, next: ProfileRecord, newId: (field: string, index: number) => string = () => crypto.randomUUID()): ItemIds {
  const beforeIds = profileItemIds(previous), result: ItemIds = {};
  for (const field of listFields) {
    const before = list(pathValue(previous, field)), after = list(pathValue(next, field)), used = new Set<number>();
    const indices = after.map(value => { const i = before.findIndex((candidate, j) => !used.has(j) && canonical(candidate) === canonical(value)); if (i >= 0) used.add(i); return i; });
    result[field] = indices.map((i, index) => {
      if (i >= 0) return beforeIds[field][i];
      if (before.length === after.length) { const available = !used.has(index) ? index : before.findIndex((_, j) => !used.has(j)); if (available >= 0) { used.add(available); return beforeIds[field][available]; } }
      return newId(field, index);
    });
  }
  return result;
}
/** Read-only upgrade: reuse known approved row identities for a legacy draft. */
export function draftWithIdentities(input: unknown, approved?: unknown): ProfileRecord {
  const draft = record(input), fallback = profileItemIds(draft), published = record(approved);
  if (Object.keys(record(draft.itemIds)).length || !Object.keys(published).length) return { ...draft, itemIds: fallback };
  return { ...draft, itemIds: reconcileItemIds(published, draft, (field, index) => fallback[field][index]) };
}
export function sanitizeProfile(input: unknown): ProfileRecord {
  const source = record(input), output = structuredClone(source), ids = profileItemIds(source);
  const hidden = new Set(list(source.hidden).filter((v): v is string => typeof v === 'string'));
  const hiddenItems = new Set(list(source.hiddenItems).filter((v): v is string => typeof v === 'string'));
  for (const field of listFields) {
    if (pathValue(source, field) !== undefined) setPath(output, field, list(pathValue(source, field)).filter((_, index) => !hiddenItems.has(`${field}:${ids[field][index]}`)));
  }
  for (const field of hidden) { if (field === 'allowContact') { output.allowContact = false; continue; } if (field.includes('.')) setPath(output, field, []); else delete output[field]; }
  for (const field of ['hidden','hiddenItems','itemIds','translations','private','notes']) delete output[field];
  return output;
}
export function withVisibility(input: unknown, policy?: VisibilityPolicy | null): ProfileRecord {
  const profile = record(input);
  return { ...profile, itemIds: profileItemIds(profile), ...(policy ? { hidden: policy.hidden, hiddenItems: policy.hiddenItems, allowContact: !policy.hidden.includes('allowContact') } : {}) };
}
