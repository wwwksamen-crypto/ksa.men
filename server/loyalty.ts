import type { Env } from './core';
import { appendAudit, now, uid } from './core';
import { deliverDecisionEmail } from './decision-email';

export const GENDERS = ['male', 'female', 'prefer_not_to_say'] as const;
export type Gender = typeof GENDERS[number];

export const AGE_BANDS = ['student', 'early_career', 'established', 'expert', 'prefer_not_to_say'] as const;
export type AgeBand = typeof AGE_BANDS[number];
export type MemberPreferences = {
  gender: Gender;
  ageBand: AgeBand;
  seasonalThemeEnabled: boolean;
  seasonalNoticesEnabled: boolean;
  badgesEnabled: boolean;
  femalePrivacyPreset: boolean;
  updatedAt: number;
};

type ChallengeKind = 'memory' | 'focus' | 'speed';
type DailyChallenge = {
  id: string;
  day: string;
  kind: ChallengeKind;
  title: string;
  prompt: string;
  choices: string[];
  answer: string;
  badge: string;
  rewardPoints: number;
};

type Season = { occasion: string; startsAt: number; endsAt: number };

const DEFAULT_MEMBER_PREFERENCES: MemberPreferences = {
  gender: 'prefer_not_to_say',
  ageBand: 'prefer_not_to_say',
  seasonalThemeEnabled: true,
  seasonalNoticesEnabled: false,
  badgesEnabled: true,
  femalePrivacyPreset: false,
  updatedAt: 0,
};
const OCCASIONS = new Set(['eid_al_fitr', 'eid_al_adha', 'national_day', 'founding_day']);

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function riyadhParts(clock = now()): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(clock * 1000)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

export function riyadhDay(clock = now()): string {
  const parts = riyadhParts(clock);
  return `${parts.year ?? '1970'}-${parts.month ?? '01'}-${parts.day ?? '01'}`;
}

export function riyadhYear(clock = now()): number {
  return Number(riyadhParts(clock).year ?? 1970);
}

export function memberPreferences(row: Record<string, unknown> | null | undefined): MemberPreferences {
  const value = row ?? {};
  const gender = GENDERS.includes(value.gender as Gender) ? value.gender as Gender : DEFAULT_MEMBER_PREFERENCES.gender;
  const ageBand = AGE_BANDS.includes(value.age_band as AgeBand) ? value.age_band as AgeBand : DEFAULT_MEMBER_PREFERENCES.ageBand;
  return {
    gender,
    ageBand,
    seasonalThemeEnabled: value.seasonal_theme_enabled === undefined ? true : Boolean(value.seasonal_theme_enabled),
    seasonalNoticesEnabled: Boolean(value.seasonal_notices_enabled),
    badgesEnabled: value.badges_enabled === undefined ? true : Boolean(value.badges_enabled),
    femalePrivacyPreset: Boolean(value.female_privacy_preset),
    updatedAt: Number(value.updated_at ?? 0),
  };
}

function seedFor(value: string): number {
  let seed = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    seed ^= value.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

function shuffled<T>(values: T[], seed: number): T[] {
  const output = [...values];
  let state = seed || 1;
  for (let index = output.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const other = state % (index + 1);
    [output[index], output[other]] = [output[other], output[index]];
  }
  return output;
}

function localized(locale: 'ar' | 'en', ar: string, en: string): string {
  return locale === 'en' ? en : ar;
}

/** The answer is retained server-side and is never returned from a public route. */
export function buildDailyChallenge(userId: number, clock = now(), locale: 'ar' | 'en' = 'ar'): DailyChallenge {
  const day = riyadhDay(clock);
  const seed = seedFor(`${userId}:${day}`);
  const kind = (['memory', 'focus', 'speed'] as ChallengeKind[])[seed % 3];
  const id = `daily-${day}`;
  if (kind === 'memory') {
    const words = locale === 'en'
      ? ['Falcon', 'Palm', 'Compass', 'Pearl', 'Lantern', 'Horizon']
      : ['الصقر', 'النخلة', 'البوصلة', 'اللؤلؤة', 'الفانوس', 'الأفق'];
    const selected = shuffled(words, seed).slice(0, 4);
    const answer = selected[1];
    return {
      id, day, kind,
      title: localized(locale, 'تمرين الذاكرة', 'Memory exercise'),
      prompt: localized(locale, `تأمل الكلمات: ${selected.join('، ')}. ما الكلمة الثانية؟`, `Look at these words: ${selected.join(', ')}. Which word was second?`),
      choices: shuffled(selected, seed ^ 0x9e3779b9), answer,
      badge: localized(locale, 'وسام الذاكرة اليومية', 'Daily memory badge'), rewardPoints: 25,
    };
  }
  if (kind === 'focus') {
    const first = 12 + (seed % 28);
    const second = 9 + ((seed >>> 7) % 24);
    const answer = String(first + second);
    const choices = [answer, String(first + second + 2), String(first + second - 3), String(first + second + 5)];
    return {
      id, day, kind,
      title: localized(locale, 'تمرين التركيز', 'Focus exercise'),
      prompt: localized(locale, `اختر الناتج الصحيح: ${first} + ${second}`, `Choose the correct result: ${first} + ${second}`),
      choices: shuffled(choices, seed ^ 0x85ebca6b), answer,
      badge: localized(locale, 'وسام التركيز اليومي', 'Daily focus badge'), rewardPoints: 25,
    };
  }
  const start = 3 + (seed % 7);
  const step = 2 + ((seed >>> 9) % 5);
  const next = start + step * 3;
  const answer = String(next);
  const choices = [answer, String(next - step), String(next + step), String(next + 2)];
  return {
    id, day, kind,
    title: localized(locale, 'تمرين سرعة البديهة', 'Quick-thinking exercise'),
    prompt: localized(locale, `ما العدد التالي؟ ${start}، ${start + step}، ${start + step * 2}، ؟`, `What comes next? ${start}, ${start + step}, ${start + step * 2}, ?`),
    choices: shuffled(choices, seed ^ 0xc2b2ae35), answer,
    badge: localized(locale, 'وسام البديهة اليومية', 'Daily quick-thinking badge'), rewardPoints: 25,
  };
}

export function publicDailyChallenge(challenge: DailyChallenge): Omit<DailyChallenge, 'answer'> {
  const { answer: _answer, ...publicChallenge } = challenge;
  return publicChallenge;
}

export function normalizeChallengeAnswer(value: string): string {
  return value.trim().toLocaleLowerCase('ar-SA');
}

export function currentSeason(value: unknown, clock = now()): Season | null {
  const season = object(value);
  const occasion = typeof season.occasion === 'string' ? season.occasion : '';
  const startsAt = Number(season.starts_at ?? season.startsAt ?? 0);
  const endsAt = Number(season.ends_at ?? season.endsAt ?? 0);
  if (!season.enabled || !OCCASIONS.has(occasion) || !Number.isFinite(startsAt) || !Number.isFinite(endsAt) || startsAt <= 0 || endsAt <= startsAt || clock < startsAt || clock > endsAt) return null;
  return { occasion, startsAt, endsAt };
}

function seasonCopy(occasion: string): { title: string; body: string; subject: string } {
  const names: Record<string, string> = {
    eid_al_fitr: 'عيد الفطر', eid_al_adha: 'عيد الأضحى', national_day: 'اليوم الوطني السعودي', founding_day: 'يوم التأسيس السعودي',
  };
  const name = names[occasion] ?? 'المناسبة الوطنية';
  return {
    title: `لمسة ${name}`,
    body: `فعّلنا لك لمسة المناسبة التي اخترتها في مساحتك. نتمنى لك وقتاً سعيداً وحضوراً يليق بك.`,
    subject: `KSA.MEN — ${name}`,
  };
}

/**
 * Runs from the existing Worker cron. Each opted-in member receives one in-app notice per
 * configured season and year. E-mail is attempted only after the internal notice is durable.
 */
export async function runSeasonalNotices(env: Env, clock = now()): Promise<{ occasion: string | null; notified: number }> {
  const setting = await env.DB.prepare("SELECT value FROM settings WHERE key='season'").first<{ value: string }>();
  let configured: unknown = null;
  try { configured = setting?.value ? JSON.parse(setting.value) : null; } catch { configured = null; }
  const season = currentSeason(configured, clock);
  if (!season) return { occasion: null, notified: 0 };
  const year = riyadhYear(clock);
  const recipients = (await env.DB.prepare(
    `SELECT u.id,u.email,u.name,n.id AS notice_id,n.notified_at
     FROM users u
     JOIN member_preferences p ON p.user_id=u.id
     LEFT JOIN occasion_notices n ON n.user_id=u.id AND n.occasion=? AND n.occasion_year=?
     WHERE u.status='active' AND p.seasonal_notices_enabled=1
       AND (n.id IS NULL OR n.notified_at IS NULL)
     ORDER BY u.id ASC LIMIT 50`,
  ).bind(season.occasion, year).all<Record<string, unknown>>()).results;
  const copy = seasonCopy(season.occasion);
  let notified = 0;
  for (const recipient of recipients) {
    const userId = Number(recipient.id);
    if (!Number.isSafeInteger(userId) || userId <= 0) continue;
    let noticeId = typeof recipient.notice_id === 'string' ? recipient.notice_id : '';
    if (!noticeId) {
      noticeId = `occasion-${uid()}`;
      try {
        await env.DB.prepare('INSERT INTO occasion_notices(id,user_id,occasion,occasion_year,created_at) VALUES(?,?,?,?,?)')
          .bind(noticeId, userId, season.occasion, year, clock).run();
      } catch {
        continue;
      }
    }
    const notificationId = `occasion-notice-${userId}-${season.occasion}-${year}`;
    try {
      await env.DB.prepare('INSERT OR IGNORE INTO notifications(id,user_id,title,body,created_at) VALUES(?,?,?,?,?)')
        .bind(notificationId, userId, copy.title, copy.body, clock).run();
      await env.DB.prepare('UPDATE occasion_notices SET notification_id=?,notified_at=? WHERE id=? AND notified_at IS NULL')
        .bind(notificationId, clock, noticeId).run();
      const delivery = await deliverDecisionEmail(env, {
        to: String(recipient.email), name: String(recipient.name || 'عضو KSA.MEN'), subject: copy.subject,
        title: copy.title, message: copy.body, actionLabel: 'فتح مساحتي', actionUrl: `https://${env.ROOT_DOMAIN}/dashboard?tab=settings`,
      });
      await env.DB.prepare('UPDATE occasion_notices SET email_status=? WHERE id=?').bind(delivery.channel, noticeId).run();
      notified += 1;
    } catch {
      // Leave the durable internal notice as the source of truth and avoid exposing provider detail.
    }
  }
  if (notified) await appendAudit(env, null, 'loyalty.occasion.notice', season.occasion, { year, notified }).catch(() => undefined);
  return { occasion: season.occasion, notified };
}
