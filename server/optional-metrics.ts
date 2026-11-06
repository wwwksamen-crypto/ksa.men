import { one, setting, type Ctx } from './core';

/** Optional behavioural metrics are off unless an owner-approved purpose is recorded. */
export async function usageMetricsEnabled(c: Ctx): Promise<boolean> {
  const decision = await setting<unknown>(c, 'optional_usage_metrics', null);
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) return false;
  const value = decision as Record<string, unknown>;
  if (value.enabled !== true || typeof value.purpose !== 'string' || !value.purpose.trim() || value.purpose.length > 200 || typeof value.approvedBy !== 'number' || !Number.isSafeInteger(value.approvedBy) || value.approvedBy < 1 || typeof value.approvedAt !== 'number' || !Number.isSafeInteger(value.approvedAt) || value.approvedAt <= 0) return false;
  const actor = await one<{ id: number }>(c, "SELECT id FROM users WHERE id=? AND role='owner' AND status='active'", value.approvedBy);
  return Boolean(actor);
}
