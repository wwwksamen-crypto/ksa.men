export type DictationMode = 'silence' | 'manual';
export type DictationState = 'idle' | 'listening' | 'error';
export type SpeechResultEvent = { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> };
export type BrowserRecognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void; abort?: () => void;
  onstart: (() => void) | null; onaudiostart: (() => void) | null;
  onspeechstart: (() => void) | null; onspeechend: (() => void) | null;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};
export type RecognitionConstructor = new () => BrowserRecognition;
export const DICTATION_SILENCE_MS = 7_000;
let activeSession: DictationSession | null = null;
export function recognitionConstructor(): RecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  const browser = window as Window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return browser.SpeechRecognition || browser.webkitSpeechRecognition;
}

/** One explicit user-started session. No recording, storage, or recognition API outside the browser. */
export class DictationSession {
  private recognition: BrowserRecognition | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | undefined;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private drainTimer: ReturnType<typeof setTimeout> | undefined;
  private deadline = 0;
  private stopping = false;
  private closed = false;
  private started = false;
  private speechEvents = false;
  private speaking = false;
  private emptyEnds = 0;
  constructor(private options: {
    Constructor: RecognitionConstructor; language: string; mode: DictationMode;
    onTranscript: (text: string) => void;
    onInterim: (text: string) => void;
    onState: (state: DictationState, reason?: string) => void;
  }) {}
  start() {
    activeSession?.cancel();
    activeSession = this;
    this.options.onState('listening');
    this.launch();
  }
  private clearSilence() { clearTimeout(this.silenceTimer); this.silenceTimer = undefined; }
  private armSilence(reset = true) {
    this.clearSilence();
    if (this.closed || this.stopping || this.options.mode === 'manual') return;
    if (reset || !this.deadline) this.deadline = Date.now() + DICTATION_SILENCE_MS;
    this.silenceTimer = setTimeout(() => this.stop(), Math.max(0, this.deadline - Date.now()));
  }
  private launch() {
    if (this.closed || this.stopping) return;
    let recognition: BrowserRecognition;
    try { recognition = new this.options.Constructor(); } catch { this.fail('unavailable'); return; }
    this.recognition = recognition;
    recognition.lang = this.options.language;
    recognition.continuous = true;
    recognition.interimResults = true;
    const processed = new Set<number>();
    let hasResults = false;
    const current = () => !this.closed && this.recognition === recognition;
    const started = () => {
      if (!current() || this.stopping) return;
      if (!this.started) { this.started = true; this.armSilence(); }
    };
    recognition.onstart = started;
    recognition.onaudiostart = started;
    recognition.onspeechstart = () => {
      if (!current() || this.stopping) return;
      this.speechEvents = true; this.speaking = true; this.started = true;
      this.clearSilence(); this.deadline = 0;
    };
    recognition.onspeechend = () => {
      if (!current() || this.stopping) return;
      this.speechEvents = true; this.speaking = false;
      this.armSilence();
    };
    recognition.onresult = event => {
      if (!current()) return;
      hasResults = true; this.emptyEnds = 0;
      // Engines without speech lifecycle events use recognition activity as the best available signal.
      if (!this.speechEvents && !this.stopping) { this.started = true; this.armSilence(); }
      const interim: string[] = [];
      for (let index = Math.max(0, event.resultIndex); index < event.results.length; index++) {
        const result = event.results[index], text = (result[0]?.transcript || '').trim();
        if (!text) continue;
        if (result.isFinal === false) { interim.push(text); continue; }
        if (processed.has(index)) continue;
        processed.add(index);
        this.options.onTranscript(text);
      }
      this.options.onInterim(this.stopping ? '' : interim.join(' '));
    };
    recognition.onerror = event => {
      if (!current()) return;
      if (this.stopping || event.error === 'aborted') { this.cancel(); return; }
      // A no-speech end can recover inside the remaining silence window, never reset that window.
      if (event.error === 'no-speech') { if (!this.deadline) this.armSilence(); return; }
      this.fail(event.error || 'unavailable');
    };
    recognition.onend = () => {
      if (!current()) return;
      this.recognition = null;
      if (this.stopping) { this.finish(); return; }
      this.options.onInterim('');
      if (this.speaking) { this.speaking = false; this.armSilence(); }
      if (!this.deadline) this.armSilence();
      if (this.options.mode === 'silence' && Date.now() >= this.deadline) { this.finish(); return; }
      this.emptyEnds = hasResults ? 0 : this.emptyEnds + 1;
      // Do not hammer a browser that repeatedly disconnects without capturing any speech.
      if (this.emptyEnds > 2) { this.fail('disconnected'); return; }
      this.restartTimer = setTimeout(() => this.launch(), 300);
    };
    try { recognition.start(); } catch { this.fail('unavailable'); }
  }
  /** Stop audio immediately, but accept the final result from this field for a bounded drain period. */
  stop() {
    if (this.closed || this.stopping) return;
    this.stopping = true;
    this.clearSilence(); clearTimeout(this.restartTimer);
    this.options.onInterim(''); this.options.onState('idle');
    if (!this.recognition) { this.finish(); return; }
    this.drainTimer = setTimeout(() => this.cancel(), 2_000);
    try { this.recognition.stop(); } catch { this.cancel(); }
  }
  /** Navigation, unmount, hidden page, or another field: no late results may be inserted. */
  cancel() {
    if (this.closed) return;
    const recognition = this.recognition;
    this.finish();
    try { if (recognition?.abort) recognition.abort(); else recognition?.stop(); } catch { /* Already ended. */ }
  }
  private finish() {
    if (this.closed) return;
    this.closed = true;
    this.clearSilence(); clearTimeout(this.restartTimer); clearTimeout(this.drainTimer);
    this.recognition = null;
    if (activeSession === this) activeSession = null;
    this.options.onInterim(''); this.options.onState('idle');
  }
  private fail(reason: string) {
    this.cancel();
    this.options.onState('error', reason);
  }
}

export function appendDictation(value: string, spoken: string, maxLength?: number): string {
  const next = `${value}${value && !/\s$/.test(value) ? ' ' : ''}${spoken.trim()}`;
  return typeof maxLength === 'number' && maxLength >= 0 ? next.slice(0, maxLength) : next;
}
// A deliberately small set of common professional words. Only explicit suggestions, never automatic rewriting.
const arabicSuggestions: Record<string, string> = {
  'مهاره': 'مهارة', 'المهاره': 'المهارة', 'خبره': 'خبرة', 'الخبره': 'الخبرة',
  'قياده': 'قيادة', 'القياده': 'القيادة', 'اداره': 'إدارة', 'إداره': 'إدارة', 'الإداره': 'الإدارة',
  'المهنيه': 'المهنية', 'السيره': 'السيرة', 'النبذه': 'النبذة', 'العضويه': 'العضوية',
};
export function arabicCorrections(spoken: string): Array<{ from: string; to: string }> {
  return [...new Set(spoken.match(/[\u0621-\u064A]+/g) || [])]
    .filter(word => arabicSuggestions[word]).slice(0, 3).map(from => ({ from, to: arabicSuggestions[from] }));
}
export function applyArabicCorrection(value: string, from: string, to: string): string {
  if (arabicSuggestions[from] !== to) return value;
  return value.replace(new RegExp(`(^|[^\\u0621-\\u064A])${from}(?=$|[^\\u0621-\\u064A])`, 'g'), `$1${to}`);
}
