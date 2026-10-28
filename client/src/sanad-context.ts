import {useEffect, useState} from 'react';

export type SanadSection = 'home' | 'auth' | 'editor' | 'review' | 'wallet' | 'admin' | 'qr' | 'unknown';

export interface SanadContextDetail {
  /** A generic app area; do not include a person's profile data in this event. */
  section?: SanadSection | string;
  /** A generic editor step key or label, such as `identity` or `experience`. */
  step?: string;
  /** Labels of required fields that still need attention, never their values. */
  requiredMissing?: string[];
  /** UI state such as `editing`, `saving`, `saved`, `review`, or `error`. */
  state?: string;
  /** A concise, non-sensitive error or recovery instruction. */
  error?: string;
  /** Optional dashboard status supplied by existing UI state. */
  saveStatus?: string;
  /** Optional review status supplied by existing UI state. */
  reviewStatus?: string;
}

export interface SanadContextState {
  section: SanadSection;
  step: string;
  requiredMissing: string[];
  state: string;
  error: string;
  saveStatus: string;
  reviewStatus: string;
  revision: number;
}

const EVENT_NAME = 'ksa:sanad-context';
const EMPTY_CONTEXT: SanadContextState = {
  section: 'unknown',
  step: '',
  requiredMissing: [],
  state: '',
  error: '',
  saveStatus: '',
  reviewStatus: '',
  revision: 0,
};

const sectionAliases: Record<string, SanadSection> = {
  home: 'home',
  auth: 'auth',
  editor: 'editor',
  dashboard: 'editor',
  review: 'review',
  wallet: 'wallet',
  admin: 'admin',
  qr: 'qr',
  unknown: 'unknown',
};

const subscribers = new Set<() => void>();
let latestContext = EMPTY_CONTEXT;

function cleanText(value: unknown, limit = 180): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, limit) : '';
}

function cleanSection(value: unknown): SanadSection {
  const normalized = cleanText(value, 32).toLowerCase();
  return sectionAliases[normalized] || 'unknown';
}

function cleanMissing(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => cleanText(item, 72)).filter(Boolean))].slice(0, 8);
}

function applyContext(detail: SanadContextDetail): void {
  latestContext = {
    section: detail.section === undefined ? latestContext.section : cleanSection(detail.section),
    step: detail.step === undefined ? latestContext.step : cleanText(detail.step, 100),
    requiredMissing: detail.requiredMissing === undefined ? latestContext.requiredMissing : cleanMissing(detail.requiredMissing),
    state: detail.state === undefined ? latestContext.state : cleanText(detail.state, 40),
    error: detail.error === undefined ? latestContext.error : cleanText(detail.error, 180),
    saveStatus: detail.saveStatus === undefined ? latestContext.saveStatus : cleanText(detail.saveStatus, 40),
    reviewStatus: detail.reviewStatus === undefined ? latestContext.reviewStatus : cleanText(detail.reviewStatus, 40),
    revision: latestContext.revision + 1,
  };
  subscribers.forEach(notify => notify());
}

function receiveContext(event: Event): void {
  const detail = (event as CustomEvent<SanadContextDetail>).detail;
  if (detail && typeof detail === 'object') applyContext(detail);
}

/* Listen at module load so a lazy page's first effect cannot outrun the guide. */
if (typeof window !== 'undefined') window.addEventListener(EVENT_NAME, receiveContext);

/**
 * A small event bridge so pages can publish UI state without the guide reading
 * form controls from the DOM. It deliberately accepts labels and state only.
 */
export function publishSanadContext(detail: SanadContextDetail): void {
  window.dispatchEvent(new CustomEvent<SanadContextDetail>(EVENT_NAME, {detail}));
}

/**
 * Reads retained context published by application pages. A new event is a
 * meaningful guide-context change, even if it remains in the same section.
 */
export function useSanadContext(): SanadContextState {
  const [context, setContext] = useState<SanadContextState>(() => latestContext);

  useEffect(() => {
    const notify = () => setContext(latestContext);
    subscribers.add(notify);
    notify();
    return () => {
      subscribers.delete(notify);
    };
  }, []);

  return context;
}

export {EVENT_NAME as SANAD_CONTEXT_EVENT};
