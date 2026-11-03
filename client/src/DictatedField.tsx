import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type TextareaHTMLAttributes, type RefObject } from 'react';
import { Mic, MicOff, SlidersHorizontal } from 'lucide-react';
import { DictationSession, recognitionConstructor, appendDictation, arabicCorrections, applyArabicCorrection, type DictationMode, type DictationState } from './dictation-session';
import './dictation.css';

type Translate = (ar: string, en: string) => string;
type Editable = HTMLInputElement | HTMLTextAreaElement;
export function VoiceButton({ value, onAppend, lang, tr, label = '', fieldRef, disabled = false, maxLength }: {
  value: string; onAppend: (value: string) => void; lang: 'ar' | 'en'; tr: Translate; label?: string;
  fieldRef?: RefObject<Editable | null>; disabled?: boolean; maxLength?: number;
}) {
  const [state, setState] = useState<DictationState>('idle');
  const [reason, setReason] = useState('');
  const [interim, setInterim] = useState('');
  const [language, setLanguage] = useState<'auto' | 'ar' | 'en'>('auto');
  const [mode, setMode] = useState<DictationMode>('silence');
  const [suggestions, setSuggestions] = useState<Array<{ from: string; to: string }>>([]);
  const sessionRef = useRef<DictationSession | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(false);
  const latest = useRef({ value, onAppend, maxLength });
  latest.current = { value, onAppend, maxLength };
  const id = useId(), selectedLanguage = language === 'auto' ? lang : language;
  const listening = state === 'listening';
  useEffect(() => {
    mounted.current = true;
    const hidden = () => { if (document.hidden) sessionRef.current?.cancel(); };
    const pagehide = () => sessionRef.current?.cancel();
    const otherField = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || controlsRef.current?.contains(target)) return;
      if (target.matches('input, textarea, select, button, a, summary, [contenteditable="true"]') && target !== fieldRef?.current) sessionRef.current?.cancel();
    };
    const outsideAction = (event: Event) => {
      const action = event.target instanceof Element ? event.target.closest('button, a, summary') : null;
      if (action && !controlsRef.current?.contains(action)) sessionRef.current?.cancel();
    };
    const composing = (event: CompositionEvent) => { if (event.target === fieldRef?.current) sessionRef.current?.cancel(); };
    document.addEventListener('visibilitychange', hidden);
    document.addEventListener('focusin', otherField);
    document.addEventListener('click', outsideAction, true);
    document.addEventListener('compositionstart', composing);
    window.addEventListener('pagehide', pagehide);
    return () => {
      mounted.current = false; sessionRef.current?.cancel();
      document.removeEventListener('visibilitychange', hidden);
      document.removeEventListener('focusin', otherField);
      document.removeEventListener('click', outsideAction, true);
      document.removeEventListener('compositionstart', composing);
      window.removeEventListener('pagehide', pagehide);
    };
  }, [fieldRef]);
  useEffect(() => { sessionRef.current?.cancel(); setInterim(''); setSuggestions([]); }, [selectedLanguage, mode, disabled]);
  const toggle = () => {
    if (listening) { sessionRef.current?.stop(); return; }
    const Constructor = recognitionConstructor();
    if (!Constructor) { setState('error'); setReason('unsupported'); return; }
    setReason(''); setSuggestions([]);
    const session = new DictationSession({ Constructor, language: selectedLanguage === 'ar' ? 'ar-SA' : 'en-US', mode,
      onTranscript: spoken => {
        if (!mounted.current || disabled) return;
        const current = latest.current;
        const next = appendDictation(current.value, spoken, current.maxLength);
        latest.current = { ...current, value: next };
        current.onAppend(next);
        if (selectedLanguage === 'ar') setSuggestions(arabicCorrections(spoken));
      },
      onInterim: text => { if (mounted.current) setInterim(text); },
      onState: (next, error) => { if (mounted.current) { setState(next); if (error) setReason(error); } },
    });
    sessionRef.current = session;
    session.start();
  };
  const actionLabel = listening ? tr('إيقاف الإملاء', 'Stop dictation') : tr('إملاء صوتي', 'Voice dictation');
  const errorText = reason === 'not-allowed' || reason === 'service-not-allowed'
    ? tr('اسمح باستخدام الميكروفون، أو تابع الكتابة.', 'Allow microphone access, or keep typing.')
    : reason === 'audio-capture'
      ? tr('تعذر الوصول إلى الميكروفون. يمكنك متابعة الكتابة.', 'Could not access the microphone. You can keep typing.')
      : reason === 'unsupported'
        ? tr('الإملاء غير متاح هنا؛ يمكنك الكتابة أو استخدام إملاء لوحة المفاتيح.', 'Dictation is unavailable here; type or use keyboard dictation.')
        : tr('توقف الإملاء. حاول مجدداً أو تابع الكتابة.', 'Dictation stopped. Try again or keep typing.');
  return <div className="dictation-controls" ref={controlsRef}>
    <div className="dictation-actions">
      <button type="button" className={`dictation-button${listening ? ' is-listening' : ''}`} onPointerDown={event => event.preventDefault()} onClick={toggle}
        aria-label={`${actionLabel}${label ? `: ${label}` : ''}`} aria-pressed={listening} aria-describedby={`${id}-status`} title={actionLabel} disabled={disabled}>
        {listening ? <MicOff size={18} aria-hidden="true"/> : <Mic size={18} aria-hidden="true"/>}<span className="sr-only">{actionLabel}</span>
      </button>
      <details className="dictation-options">
        <summary aria-label={`${tr('خيارات الإملاء', 'Dictation options')}${label ? `: ${label}` : ''}`}><SlidersHorizontal size={15} aria-hidden="true"/><span>{tr('خيارات', 'Options')}</span></summary>
        <div className="dictation-options-body">
          <label htmlFor={`${id}-language`}>{tr('لغة الإملاء', 'Dictation language')}</label>
          <select id={`${id}-language`} value={language} onChange={event => setLanguage(event.target.value as typeof language)} disabled={disabled}>
            <option value="auto">{tr('لغة المساحة', 'Page language')}</option><option value="ar">العربية</option><option value="en">English</option>
          </select>
          <label htmlFor={`${id}-mode`}>{tr('وقت الإيقاف', 'When to stop')}</label>
          <select id={`${id}-mode`} value={mode} onChange={event => setMode(event.target.value as DictationMode)} disabled={disabled}>
            <option value="silence">{tr('بعد صمت 7 ثوانٍ', 'After 7 seconds of silence')}</option><option value="manual">{tr('عند ضغط إيقاف فقط', 'Only when I press Stop')}</option>
          </select>
          <p>{tr('الإملاء اختياري. قد يستخدم متصفحك خدمة صوت عبر الإنترنت؛ راجع النص قبل اعتماده.', 'Dictation is optional. Your browser may use an online speech service; review the text before using it.')}</p>
        </div>
      </details>
    </div>
    <p id={`${id}-status`} className={`dictation-status${state === 'idle' ? ' sr-only' : ''}`} role="status" aria-live="polite" aria-atomic="true">
      {state === 'error' ? errorText : listening ? tr('أستمع إليك. اضغط إيقاف متى شئت.', 'Listening. Press Stop whenever you like.') : tr('الإملاء متوقف.', 'Dictation is stopped.')}
    </p>
    {interim && <p className="dictation-interim" aria-hidden="true">{interim}</p>}
    {suggestions.length > 0 && <div className="dictation-corrections" aria-label={tr('اقتراحات اختيارية', 'Optional suggestions')}>
      {suggestions.map(suggestion => <button type="button" key={suggestion.from} onPointerDown={event => event.preventDefault()} onClick={() => {
        const current = latest.current, next = applyArabicCorrection(current.value, suggestion.from, suggestion.to);
        if (next !== current.value && (current.maxLength === undefined || next.length <= current.maxLength)) { latest.current = { ...current, value: next }; current.onAppend(next); }
        setSuggestions(items => items.filter(item => item.from !== suggestion.from));
      }}>{tr('هل تقصد', 'Did you mean')} «{suggestion.to}»؟</button>)}
      <button type="button" onClick={() => setSuggestions([])} aria-label={tr('تجاهل الاقتراحات', 'Dismiss suggestions')}>{tr('تجاهل', 'Dismiss')}</button>
    </div>}
  </div>;
}

type Common = { value: string; onChange: (value: string) => void; lang: 'ar' | 'en'; tr: Translate; label?: string };
export function DictatedInput({ value, onChange, lang, tr, label, className = 'field', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & Common) {
  const generatedId = useId(), fieldRef = useRef<HTMLInputElement | null>(null), id = props.id || generatedId;
  const name = label || props['aria-label'] || tr('نص', 'Text');
  return <div className="dictated-field">
    {label && <label htmlFor={id}>{label}</label>}
    <input {...props} id={id} ref={fieldRef} className={className} aria-label={label ? undefined : props['aria-label']} value={value} onChange={event => onChange(event.target.value)}/>
    <VoiceButton fieldRef={fieldRef} value={value} onAppend={onChange} label={name} lang={lang} tr={tr} disabled={props.disabled || props.readOnly} maxLength={props.maxLength}/>
  </div>;
}
export function DictatedTextarea({ value, onChange, lang, tr, label, rows = 5, className = 'field', ...props }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & Common) {
  const generatedId = useId(), fieldRef = useRef<HTMLTextAreaElement | null>(null), id = props.id || generatedId;
  const name = label || props['aria-label'] || tr('نص', 'Text');
  return <div className="dictated-field dictated-field--textarea">
    {label && <label htmlFor={id}>{label}</label>}
    <textarea {...props} id={id} ref={fieldRef} className={className} rows={rows} aria-label={label ? undefined : props['aria-label']} value={value} onChange={event => onChange(event.target.value)}/>
    <VoiceButton fieldRef={fieldRef} value={value} onAppend={onChange} label={name} lang={lang} tr={tr} disabled={props.disabled || props.readOnly} maxLength={props.maxLength}/>
  </div>;
}
