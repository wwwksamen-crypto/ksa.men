import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DictationSession, appendDictation, arabicCorrections, applyArabicCorrection, type BrowserRecognition, type DictationMode, type SpeechResultEvent } from '../client/src/dictation-session';
class Recognition implements BrowserRecognition {
  static instances: Recognition[] = [];
  lang = ''; continuous = false; interimResults = false;
  start = vi.fn(); stop = vi.fn(); abort = vi.fn();
  onstart: (() => void) | null = null; onaudiostart: (() => void) | null = null;
  onspeechstart: (() => void) | null = null; onspeechend: (() => void) | null = null;
  onresult: ((event: SpeechResultEvent) => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null; onend: (() => void) | null = null;
  constructor() { Recognition.instances.push(this); }
}
const final = (text: string, isFinal = true) => Object.assign([{ transcript: text }], { isFinal });
const create = (mode: DictationMode = 'silence') => {
  const onTranscript = vi.fn(), onInterim = vi.fn(), onState = vi.fn();
  const session = new DictationSession({ Constructor: Recognition, mode, language: 'ar-SA', onTranscript, onInterim, onState });
  session.start(); const recognition = Recognition.instances.at(-1)!;
  recognition.onstart?.();
  return { session, recognition, onTranscript, onInterim, onState };
};
describe('dictation lifecycle — timer tests, no browser', () => {
  beforeEach(() => { vi.useFakeTimers(); Recognition.instances = []; });
  afterEach(() => { const cleanup = create(); cleanup.session.cancel(); vi.useRealTimers(); });
  it('keeps listening during speech and stops exactly seven seconds after speechend', () => {
    const { recognition } = create();
    expect(recognition.continuous).toBe(true); expect(recognition.lang).toBe('ar-SA');
    recognition.onspeechstart?.(); vi.advanceTimersByTime(20_000); expect(recognition.stop).not.toHaveBeenCalled();
    recognition.onspeechend?.(); vi.advanceTimersByTime(6_999); expect(recognition.stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(recognition.stop).toHaveBeenCalledTimes(1);
  });
  it('allows a manual-only session to continue beyond seven seconds and accepts one final after stop', () => {
    const { session, recognition, onTranscript } = create('manual');
    recognition.onspeechend?.(); vi.advanceTimersByTime(30_000); expect(recognition.stop).not.toHaveBeenCalled();
    session.stop(); recognition.onresult?.({ resultIndex: 0, results: [final('مهارة')] }); recognition.onend?.();
    recognition.onresult?.({ resultIndex: 0, results: [final('متأخر')] });
    expect(onTranscript).toHaveBeenCalledTimes(1); expect(onTranscript).toHaveBeenCalledWith('مهارة');
  });
  it('cancels an old session when another field starts and ignores late results', () => {
    const first = create(), second = create();
    expect(first.recognition.abort).toHaveBeenCalledOnce();
    first.recognition.onresult?.({ resultIndex: 0, results: [final('wrong field')] });
    second.recognition.onresult?.({ resultIndex: 0, results: [final('right field')] });
    expect(first.onTranscript).not.toHaveBeenCalled(); expect(second.onTranscript).toHaveBeenCalledWith('right field');
  });
  it('previews interim speech without writing it and processes final indexes just once', () => {
    const { recognition, onTranscript, onInterim } = create();
    recognition.onresult?.({ resultIndex: 0, results: [final('القياد', false)] });
    expect(onTranscript).not.toHaveBeenCalled(); expect(onInterim).toHaveBeenCalledWith('القياد');
    const event = { resultIndex: 0, results: [final('القياده'), final('مهنية')] };
    recognition.onresult?.(event); recognition.onresult?.(event);
    expect(onTranscript.mock.calls).toEqual([['القياده'], ['مهنية']]);
  });
  it('recovers a normal browser disconnect without resetting the silence deadline', () => {
    const { recognition } = create(); vi.advanceTimersByTime(3_000); recognition.onend?.();
    vi.advanceTimersByTime(300); const restarted = Recognition.instances.at(-1)!; expect(restarted).not.toBe(recognition);
    restarted.onstart?.(); vi.advanceTimersByTime(3_700); expect(restarted.stop).toHaveBeenCalledOnce();
  });
  it('does not repeatedly restart a failed or permission-denied microphone', () => {
    const { recognition, onState } = create(); recognition.onerror?.({ error: 'not-allowed' }); recognition.onend?.();
    vi.advanceTimersByTime(30_000); expect(Recognition.instances).toHaveLength(1);
    expect(onState).toHaveBeenLastCalledWith('error', 'not-allowed');
  });
  it('handles a constructor failure without escaping into the UI or leaving an active recorder', () => {
    class BrokenRecognition extends Recognition { constructor() { super(); throw new Error('unsupported'); } }
    const onState = vi.fn();
    const session = new DictationSession({ Constructor: BrokenRecognition, mode:'silence',language:'ar-SA',onState,onTranscript:vi.fn(),onInterim:vi.fn() });
    expect(() => session.start()).not.toThrow();
    expect(onState).toHaveBeenLastCalledWith('error','unavailable');
  });
  it('uses the last result activity as the silence fallback when speech events are unavailable', () => {
    const { recognition } = create(); vi.advanceTimersByTime(6_000);
    recognition.onresult?.({resultIndex:0,results:[final('نص')]});
    vi.advanceTimersByTime(6_999);expect(recognition.stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);expect(recognition.stop).toHaveBeenCalledOnce();
  });
  it('cancels the bounded drain so a very late result cannot be appended', () => {
    const { session, recognition, onTranscript } = create(); session.stop(); vi.advanceTimersByTime(2_000);
    recognition.onresult?.({ resultIndex: 0, results: [final('too late')] }); expect(onTranscript).not.toHaveBeenCalled();
  });
  it('preserves the latest manual text, whitespace and limits while keeping Arabic names untouched', () => {
    expect(appendDictation('تعديل يدوي جديد', 'خبره')).toBe('تعديل يدوي جديد خبره');
    expect(appendDictation('سطر\n', 'مهاره')).toBe('سطر\nمهاره');
    expect(appendDictation('abc', 'def', 6)).toBe('abc de');
    expect(arabicCorrections('الله عبدالله وجه خبره مهاره')).toEqual([{ from: 'خبره', to: 'خبرة' }, { from: 'مهاره', to: 'مهارة' }]);
    expect(applyArabicCorrection('عبدالله وجه، مهاره.', 'مهاره', 'مهارة')).toBe('عبدالله وجه، مهارة.');
    expect(applyArabicCorrection('وجه', 'وجه', 'وجة')).toBe('وجه');
  });
});
