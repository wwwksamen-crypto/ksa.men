import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AudioLines, CirclePause, CirclePlay, Eye, EyeOff, RotateCcw, Square, Volume2, X} from 'lucide-react';
import {useApp} from './lib';
import {type SanadContextState, type SanadSection, useSanadContext} from './sanad-context';
import './sanad.css';

type SpriteFrame = 'neutral' | 'speaking' | 'large' | 'blink';
type PlayerStatus = 'idle' | 'playing' | 'paused' | 'error';

interface AudioScript {
  id: string;
  src: string;
  ar: string;
  en: string;
}

/**
 * These are the exact scripts the corresponding static recordings must use.
 * Dynamic guidance below is intentionally not spoken or sent anywhere.
 */
export const SANAD_AUDIO_SCRIPTS: Record<string, AudioScript> = {
  'home-ar': {
    id: 'home-ar',
    src: '/assets/sanad/home-ar.mp3',
    ar: "حيّ الله من جانا. أنا سند، رفيقك في ظهور رقمي يليق بك. ابدأ باسمك، واجمع مسيرتك في موقع خاص بك. وإذا احتجت مساعدة، تلقاني هنا خطوة بخطوة.",
    en: 'Welcome. I am Sanad, here to help you build a professional presence you can share with confidence.',
  },
  'auth-ar': {
    id: 'auth-ar',
    src: '/assets/sanad/auth-ar.mp3',
    ar: "حي الله فخرنا، احتزم، معاك لين تخلص موقعك. اكتب بريدك الصحيح، وتحقق بالرمز اللي يوصلك. للدخول السريع، استخدم بريد الحساب ورمزك الشخصي على جهاز موثوق. لا تشارك رمز التحقق مع أحد.",
    en: 'Start with an email you actively use. The verification code proves account ownership, and a PIN works only on a trusted device.',
  },
  'editor-ar': {
    id: 'editor-ar',
    src: '/assets/sanad/editor-ar.mp3',
    ar: "خلّنا نبني حضورك خطوة بخطوة. ابدأ باسمك ومسمّاك، ثم اكتب نبذة صادقة عن خبرتك. تنحفظ تعديلاتك تلقائيًا. راجع المعاينة، وتأكد من بياناتك قبل إرسالها للمراجعة.",
    en: 'Start with your core identity, then complete each step with information people can trust. Save first, then review what you want to submit for publication.',
  },
  'review-ar': {
    id: 'review-ar',
    src: '/assets/sanad/review-ar.mp3',
    ar: "موقعك يعكسك. قبل الإرسال، راجع الاسم والمسمّى ووسائل التواصل والخصوصية. إرسال المراجعة يحفظ نسخة ثابتة للمشرف، وتقدر تكمل تعديل مسودتك بدون ما تتغير النسخة المرسلة.",
    en: 'Review is a final opportunity to confirm that your information is accurate and clear. Submit only what represents your journey as it is.',
  },
  'wallet-ar': {
    id: 'wallet-ar',
    src: '/assets/sanad/wallet-ar.mp3',
    ar: "هذا رصيد نقاط التميز المهني. يمكنك إهداء نقاط التقدير للحسابات الأخرى بعد مراجعة المستفيد والعدد. النقاط غير نقدية ولا تُشترى أو تُسترد أو تُحوّل إلى نقود أو استحقاق، وكل حركة تظهر في سجلك.",
    en: 'Points recognize your participation and can be used with available services. They are not cash and cannot be converted to cash.',
  },
  'admin-ar': {
    id: 'admin-ar',
    src: '/assets/sanad/admin-ar.mp3',
    ar: "هنا قيادة المنصة. ابدأ بما يحتاج قرارك، ثم انتقل للمراجعات أو المستخدمين أو الخدمات. العمليات الحساسة تحتاج تحققًا جديدًا بالبريد. اقرأ تفاصيل الإجراء قبل اعتماده، وخلّ قرارك واضحًا وموثقًا.",
    en: 'In administration, review requests and status before taking action. Keep a clear record for each decision and do not share data the task does not need.',
  },
  'qr-ar': {
    id: 'qr-ar',
    src: '/assets/sanad/qr-ar.mp3',
    ar: "شارك حضورك بلمسة. اختر رابطًا أو بطاقة اتصال، وتأكد من البيانات ثم أنشئ رمزك. جرّب مسحه قبل الطباعة، وخلي حول الرمز مساحة بيضاء واضحة. ما تحتاج حساب عشان تستخدم هذه الأداة.",
    en: 'Turn the link or contact details you choose into a clear QR code ready to share or print.',
  },
  'home-en': {
    id: 'home-en',
    src: '/assets/sanad/home-en.mp3',
    ar: 'مرحبًا بك في KSA.MEN. أنا سند، أساعدك على بناء حضور مهني واضح يمكنك مشاركته بثقة.',
    en: "Hi, I’m Sanad, your digital guide. Your experience deserves a place of its own. Create your identity, choose what you want to share, and explore your tools. I’m here when you need a hand.",
  },
};

const knownSections = new Set<SanadSection>(['home', 'auth', 'editor', 'review', 'wallet', 'admin', 'qr']);

function sectionFromPath(path: string): SanadSection {
  if (path === '/auth') return 'auth';
  if (path === '/dashboard') return 'editor';
  if (path === '/admin') return 'admin';
  if (path === '/qr') return 'qr';
  if (path.startsWith('/export/')) return 'review';
  return 'home';
}

function normaliseStep(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_\-]+/g, '');
}

interface Guidance {
  ar: string;
  en: string;
}

const STEP_GUIDANCE: Record<string, Guidance> = {
  identity: {ar: 'ابدأ بالاسم والمسمى، ثم أضف صورة واضحة وغلافًا بانوراميًا.', en: 'Start with your name and title, then add a clear portrait and a panoramic cover.'},
  الهوية: {ar: 'ابدأ بالاسم والمسمى، ثم أضف صورة واضحة وغلافًا بانوراميًا.', en: 'Start with your name and title, then add a clear portrait and a panoramic cover.'},
  introduction: {ar: 'اكتب نبذة صادقة توضح ما تقدمه ولماذا يهم.', en: 'Write an honest bio that explains what you offer and why it matters.'},
  bio: {ar: 'اكتب نبذة صادقة توضح ما تقدمه ولماذا يهم.', en: 'Write an honest bio that explains what you offer and why it matters.'},
  نبذة: {ar: 'اكتب نبذة صادقة توضح ما تقدمه ولماذا يهم.', en: 'Write an honest bio that explains what you offer and why it matters.'},
  contact: {ar: 'اختر وسائل التواصل التي ترغب حقًا في ظهورها للزوار.', en: 'Choose only the contact channels you genuinely want visitors to see.'},
  التواصل: {ar: 'اختر وسائل التواصل التي ترغب حقًا في ظهورها للزوار.', en: 'Choose only the contact channels you genuinely want visitors to see.'},
  experience: {ar: 'رتّب الخبرات من الأحدث، وأضف جهة وتاريخًا قابلين للتأكيد.', en: 'List the newest experience first, with an organization and dates that can be verified.'},
  الخبرات: {ar: 'رتّب الخبرات من الأحدث، وأضف جهة وتاريخًا قابلين للتأكيد.', en: 'List the newest experience first, with an organization and dates that can be verified.'},
  education: {ar: 'أضف المؤهل والجهة كما يظهران في سجلك الرسمي.', en: 'Add qualifications and institutions exactly as they appear in your official record.'},
  التعليم: {ar: 'أضف المؤهل والجهة كما يظهران في سجلك الرسمي.', en: 'Add qualifications and institutions exactly as they appear in your official record.'},
  training: {ar: 'أضف برامج التطوير التي تدعم تخصصك الحالي.', en: 'Add development programmes that support your current specialty.'},
  التدريب: {ar: 'أضف برامج التطوير التي تدعم تخصصك الحالي.', en: 'Add development programmes that support your current specialty.'},
  skills: {ar: 'اجعل كل مهارة مستقلة، ثم أضف إثباتًا بصريًا عند توفره.', en: 'Keep each skill distinct, then add visual evidence when it is available.'},
  المهارات: {ar: 'اجعل كل مهارة مستقلة، ثم أضف إثباتًا بصريًا عند توفره.', en: 'Keep each skill distinct, then add visual evidence when it is available.'},
  memberships: {ar: 'اذكر العضويات المهنية النشطة والجهة المانحة لها.', en: 'List active professional memberships and the organization that issued them.'},
  العضويات: {ar: 'اذكر العضويات المهنية النشطة والجهة المانحة لها.', en: 'List active professional memberships and the organization that issued them.'},
  languages: {ar: 'اكتب اللغات التي تستطيع استخدامها مهنيًا بثقة.', en: 'List the languages you can use professionally with confidence.'},
  اللغات: {ar: 'اكتب اللغات التي تستطيع استخدامها مهنيًا بثقة.', en: 'List the languages you can use professionally with confidence.'},
  achievements: {ar: 'ركّز على إنجازات قابلة للتأكيد وتظهر أثر عملك.', en: 'Focus on verifiable achievements that demonstrate your impact.'},
  الإنجازات: {ar: 'ركّز على إنجازات قابلة للتأكيد وتظهر أثر عملك.', en: 'Focus on verifiable achievements that demonstrate your impact.'},
  timeline: {ar: 'رتّب المحطات المهنية زمنيًا ليصبح أثر مسيرتك واضحًا.', en: 'Order milestones chronologically so the impact of your journey is clear.'},
  السجلالزمني: {ar: 'رتّب المحطات المهنية زمنيًا ليصبح أثر مسيرتك واضحًا.', en: 'Order milestones chronologically so the impact of your journey is clear.'},
  evidence: {ar: 'اختر أدلة مختصرة ومرتبطة بمهاراتك، مع مراعاة الخصوصية.', en: 'Choose concise evidence that relates to your skills, while respecting privacy.'},
  skillsvidence: {ar: 'اختر أدلة مختصرة ومرتبطة بمهاراتك، مع مراعاة الخصوصية.', en: 'Choose concise evidence that relates to your skills, while respecting privacy.'},
  worksamples: {ar: 'اختر نماذج تمثل مستوى عملك الحالي وتشرح دورك بوضوح.', en: 'Choose samples that represent your current standard and clearly explain your role.'},
  نماذجالأعمال: {ar: 'اختر نماذج تمثل مستوى عملك الحالي وتشرح دورك بوضوح.', en: 'Choose samples that represent your current standard and clearly explain your role.'},
  video: {ar: 'استخدم رابط فيديو تعريفيًا واضحًا؛ لن يظهر للزوار قبل تفاعلهم.', en: 'Use a clear introduction-video link; it will not appear to visitors before they interact.'},
  links: {ar: 'استخدم روابط موثوقة تعزز حضورك المهني.', en: 'Use trusted links that strengthen your professional presence.'},
  sociallinks: {ar: 'استخدم روابط موثوقة تعزز حضورك المهني.', en: 'Use trusted links that strengthen your professional presence.'},
  privacy: {ar: 'راجع الحقول المخفية قبل الإرسال؛ الإخفاء يمنع ظهورها العام.', en: 'Review hidden fields before submitting; hidden fields stay out of public display.'},
  الخصوصية: {ar: 'راجع الحقول المخفية قبل الإرسال؛ الإخفاء يمنع ظهورها العام.', en: 'Review hidden fields before submitting; hidden fields stay out of public display.'},
};

function getDynamicGuidance(context: SanadContextState, section: SanadSection): Guidance {
  const step = STEP_GUIDANCE[normaliseStep(context.step)];
  if (step) return step;
  if (context.error) {
    return {
      ar: `توجد ملاحظة تحتاج انتباهك: ${context.error}`,
      en: `There is an item that needs your attention: ${context.error}`,
    };
  }
  if (section === 'auth') return {ar: 'استخدم بريدًا تملكه وتستطيع الوصول إليه، ثم أكمل التحقق بهدوء.', en: 'Use an email address you own and can access, then complete verification at your pace.'};
  if (section === 'review') return {ar: 'راجع الوضوح والدقة قبل الإرسال؛ التعديل الصادق هو أفضل مراجعة.', en: 'Review clarity and accuracy before submitting; an honest edit is the best review.'};
  if (section === 'wallet') return {ar: 'راجع رصيدك وسجل الحركة من داخل الحساب قبل اختيار أي خدمة.', en: 'Review your balance and activity inside your account before choosing a service.'};
  if (section === 'admin') return {ar: 'اعمل من الحالة المعروضة في النظام، وراجع الطلب قبل اعتماد أي إجراء.', en: 'Work from the status shown in the system and review each request before approving an action.'};
  if (section === 'qr') return {ar: 'تأكد من الرابط أو بيانات الاتصال قبل إنشاء رمز قابل للمشاركة.', en: 'Confirm the link or contact details before creating a shareable code.'};
  return {ar: 'اختر اسمًا يعبر عنك، واجمع خبراتك وروابطك في موقع واحد ثم شاركه بثقة.', en: 'Choose a name that represents you, bring your experience and links together, then share them confidently.'};
}

function getMissingGuidance(requiredMissing: string[], lang: 'ar' | 'en'): string {
  if (requiredMissing.length) {
    const labels = requiredMissing.map(label => `«${label}»`).join(lang === 'ar' ? '، ' : ', ');
    return lang === 'ar'
      ? `يلزم الانتباه إلى الحقول المطلوبة التالية: ${labels}.`
      : `These required fields still need attention: ${labels}.`;
  }
  return lang === 'ar'
    ? 'قبل الحفظ، راجع دقة معلوماتك ووسائل التواصل التي اخترت إظهارها.'
    : 'Before saving, review your information and the contact details you chose to make public.';
}

function useReducedMotionPreference(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return reduced;
}

function useKeyboardVisibility(): boolean {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const focused = document.activeElement;
      const editable = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement || focused instanceof HTMLSelectElement || (focused instanceof HTMLElement && focused.isContentEditable);
      const obscured = window.innerHeight - viewport.height - viewport.offsetTop > 140;
      setKeyboardOpen(editable && obscured);
    };
    const handleFocusOut = () => window.setTimeout(update, 0);
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    window.addEventListener('focusin', update);
    window.addEventListener('focusout', handleFocusOut);
    update();
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      window.removeEventListener('focusin', update);
      window.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  return keyboardOpen;
}

function useOtherModalOpen(): boolean {
  const [otherModal, setOtherModal] = useState(false);

  useEffect(() => {
    const update = () => {
      const nativeModal = document.querySelector('dialog[open]:not([data-sanad-dialog])');
      const roleModal = document.querySelector('[role="dialog"][aria-modal="true"]:not([data-sanad-dialog])');
      setOtherModal(Boolean(nativeModal || roleModal));
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'aria-modal', 'role']});
    update();
    return () => observer.disconnect();
  }, []);

  return otherModal;
}

function audioFor(section: SanadSection, lang: 'ar' | 'en'): AudioScript {
  if (lang === 'en') return SANAD_AUDIO_SCRIPTS['home-en'];
  const id = `${section}-ar`;
  return SANAD_AUDIO_SCRIPTS[id] || SANAD_AUDIO_SCRIPTS['home-ar'];
}

export default function Sanad() {
  const {lang, t} = useApp();
  const context = useSanadContext();
  const prefersReducedMotion = useReducedMotionPreference();
  const keyboardOpen = useKeyboardVisibility();
  const otherModalOpen = useOtherModalOpen();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const rafRef = useRef<number | null>(null);
  const blinkTimerRef = useRef<number | null>(null);
  const userMotionPreference = useRef<string | null>(typeof window === 'undefined' ? null : localStorage.getItem('ksa-sanad-motion'));

  const [hiddenPreference, setHiddenPreference] = useState(() => typeof window !== 'undefined' && localStorage.getItem('ksa-sanad') === 'hidden');
  const [open, setOpen] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(() => userMotionPreference.current ? userMotionPreference.current === 'on' : !prefersReducedMotion);
  const [spriteFrame, setSpriteFrame] = useState<SpriteFrame>('neutral');
  const [playerStatus, setPlayerStatus] = useState<PlayerStatus>('idle');
  const [playerError, setPlayerError] = useState('');

  const section = useMemo<SanadSection>(() => knownSections.has(context.section) ? context.section : sectionFromPath(window.location.pathname), [context.section]);
  const audioScript = useMemo(() => audioFor(section, lang), [section, lang]);
  const dynamicGuidance = useMemo(() => getDynamicGuidance(context, section), [context, section]);
  const guidance = lang === 'ar' ? dynamicGuidance.ar : dynamicGuidance.en;
  const missingGuidance = useMemo(() => getMissingGuidance(context.requiredMissing, lang), [context.requiredMissing, lang]);
  const transcript = lang === 'ar' ? audioScript.ar : audioScript.en;
  const isTemporarilyUnavailable = keyboardOpen || otherModalOpen;

  const stopAnimationLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const blink = useCallback(() => {
    if (!motionEnabled || prefersReducedMotion) return;
    if (blinkTimerRef.current !== null) window.clearTimeout(blinkTimerRef.current);
    setSpriteFrame('blink');
    blinkTimerRef.current = window.setTimeout(() => setSpriteFrame('neutral'), 170);
  }, [motionEnabled, prefersReducedMotion]);

  const stopAudio = useCallback((reset = true) => {
    stopAnimationLoop();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      if (reset) audio.currentTime = 0;
    }
    if (audioContextRef.current?.state === 'running') void audioContextRef.current.suspend();
    setPlayerStatus('idle');
    setSpriteFrame('neutral');
  }, [stopAnimationLoop]);

  const ensureAudioGraph = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return null;
    if (!audioContextRef.current) {
      const AudioContextConstructor = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextConstructor) return null;
      const contextInstance = new AudioContextConstructor();
      const analyser = contextInstance.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.68;
      const source = contextInstance.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(contextInstance.destination);
      audioContextRef.current = contextInstance;
      sourceRef.current = source;
      analyserRef.current = analyser;
      analyserDataRef.current = new Uint8Array(analyser.fftSize);
    }
    return audioContextRef.current;
  }, []);

  const startAnimationLoop = useCallback(() => {
    stopAnimationLoop();
    if (!motionEnabled || prefersReducedMotion || !analyserRef.current || !analyserDataRef.current) {
      setSpriteFrame('neutral');
      return;
    }
    let lastFrame = 0;
    const sample = (timestamp: number) => {
      if (timestamp-lastFrame < 75) { rafRef.current = requestAnimationFrame(sample); return; }
      lastFrame = timestamp;
      const analyser = analyserRef.current;
      const data = analyserDataRef.current;
      if (!analyser || !data) return;
      analyser.getByteTimeDomainData(data);
      let squaredSum = 0;
      for (const value of data) {
        const normalized = (value - 128) / 128;
        squaredSum += normalized * normalized;
      }
      const rms = Math.sqrt(squaredSum / data.length);
      setSpriteFrame(previous => {
        const next: SpriteFrame = rms > 0.13 ? 'large' : rms > 0.025 ? 'speaking' : 'neutral';
        return previous === next ? previous : next;
      });
      rafRef.current = requestAnimationFrame(sample);
    };
    rafRef.current = requestAnimationFrame(sample);
  }, [motionEnabled, prefersReducedMotion, stopAnimationLoop]);

  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    setPlayerError('');
    try {
      const audioContext = ensureAudioGraph();
      if (audioContext?.state === 'suspended') await audioContext.resume();
      await audio.play();
      setPlayerStatus('playing');
      blink();
      startAnimationLoop();
    } catch {
      stopAnimationLoop();
      setPlayerStatus('error');
      setPlayerError(t('تعذر تشغيل التسجيل الآن. تأكد من توفر الملف ثم أعد المحاولة.', 'The recording could not play. Confirm the file is available and try again.'));
    }
  }, [blink, ensureAudioGraph, startAnimationLoop, stopAnimationLoop, t]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    stopAnimationLoop();
    setPlayerStatus('paused');
    setSpriteFrame('neutral');
  }, [stopAnimationLoop]);

  const close = useCallback(() => {
    stopAudio(true);
    setOpen(false);
  }, [stopAudio]);

  const openGuide = useCallback(() => {
    if (isTemporarilyUnavailable) return;
    setOpen(true);
    blink();
  }, [blink, isTemporarilyUnavailable]);

  useEffect(() => {
    const openRequested = () => openGuide();
    window.addEventListener('ksa:sanad-open',openRequested);
    return () => window.removeEventListener('ksa:sanad-open',openRequested);
  },[openGuide]);
  useEffect(() => {
    if (!open) return;
    const previous=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return () => {document.body.style.overflow=previous;};
  },[open]);

  const hideGuide = useCallback(() => {
    close();
    sourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') void audioContextRef.current.close();
    audioContextRef.current = null; sourceRef.current = null; analyserRef.current = null; analyserDataRef.current = null;
    localStorage.setItem('ksa-sanad', 'hidden');
    setHiddenPreference(true);
  }, [close]);

  const restoreGuide = useCallback(() => {
    localStorage.removeItem('ksa-sanad');
    setHiddenPreference(false);
    window.setTimeout(openGuide, 0);
  }, [openGuide]);

  const toggleMotion = useCallback(() => {
    const next = !motionEnabled;
    localStorage.setItem('ksa-sanad-motion', next ? 'on' : 'off');
    userMotionPreference.current = next ? 'on' : 'off';
    setMotionEnabled(next);
    if (!next) {
      stopAnimationLoop();
      setSpriteFrame('neutral');
    } else if (playerStatus === 'playing') {
      startAnimationLoop();
    }
  }, [motionEnabled, playerStatus, startAnimationLoop, stopAnimationLoop]);

  useEffect(() => {
    if (!userMotionPreference.current) setMotionEnabled(!prefersReducedMotion);
  }, [prefersReducedMotion]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !isTemporarilyUnavailable) {
      if (!dialog.open) dialog.showModal();
      window.setTimeout(() => dialog.querySelector<HTMLElement>('[data-sanad-autofocus]')?.focus(), 0);
    } else if (dialog.open) {
      dialog.close();
    }
  }, [isTemporarilyUnavailable, open]);

  useEffect(() => {
    if (isTemporarilyUnavailable && open) close();
  }, [close, isTemporarilyUnavailable, open]);

  useEffect(() => {
    stopAudio(true);
  }, [audioScript.id, context.step, stopAudio]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') stopAudio(false);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [stopAudio]);

  useEffect(() => {
    return () => {
      stopAnimationLoop();
      if (blinkTimerRef.current !== null) window.clearTimeout(blinkTimerRef.current);
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.src = '';
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') void audioContextRef.current.close();
      sourceRef.current = null;
      analyserRef.current = null;
    };
  }, [stopAnimationLoop]);

  useEffect(() => {
    if (playerStatus === 'playing') startAnimationLoop();
    else { stopAnimationLoop(); setSpriteFrame('neutral'); }
  }, [motionEnabled, prefersReducedMotion, playerStatus, startAnimationLoop, stopAnimationLoop]);

  const statusText = playerStatus === 'playing'
    ? t('قيد التشغيل', 'Playing')
    : playerStatus === 'paused'
      ? t('متوقف مؤقتًا', 'Paused')
      : playerStatus === 'error'
        ? t('تعذر التشغيل', 'Could not play')
        : t('جاهز للتشغيل', 'Ready to play');

  const guideLabel = t('سند، دليلك في KSA.MEN', 'Sanad, your KSA.MEN guide');

  if (hiddenPreference) {
    return (
      <section className="sanad-inline-slot" aria-label={guideLabel} hidden={isTemporarilyUnavailable}>
        <button className="sanad-inline-guide" type="button" onClick={restoreGuide}>
          <AudioLines size={18} aria-hidden="true" />
          <span>
            <strong>{t('إرشاد سند', 'Sanad guidance')}</strong>
            <span>{guidance}</span>
          </span>
          <span className="sanad-inline-action">{t('إظهار', 'Show')}</span>
        </button>
      </section>
    );
  }

  return (
    <aside className="sanad-dock" aria-label={guideLabel} hidden={isTemporarilyUnavailable}>
      <div className="sanad-dock-inner">
        <button className="sanad-launch" type="button" onClick={openGuide} aria-haspopup="dialog" aria-expanded={open}>
          <span className="sanad-sprite sanad-sprite--dock sanad-sprite--neutral" aria-hidden="true" />
          <span className="sanad-launch-copy">
            <strong>{t('معك سند', 'Sanad is here')}</strong>
            <span>{guidance}</span>
          </span>
          <AudioLines size={19} aria-hidden="true" />
        </button>
        <button className="sanad-dock-hide" type="button" onClick={hideGuide} aria-label={t('إخفاء سند مع إبقاء الإرشاد النصي', 'Hide Sanad and keep text guidance')}>
          <EyeOff size={17} aria-hidden="true" />
          <span>{t('إخفاء', 'Hide')}</span>
        </button>
      </div>

      <dialog
        ref={dialogRef}
        className="sanad-dialog"
        data-sanad-dialog
        aria-labelledby="sanad-dialog-title"
        onCancel={event => {
          event.preventDefault();
          close();
        }}
        onClose={() => {
          if (open) setOpen(false);
        }}
      >
        <div className="sanad-dialog-layout">
          <header className="sanad-dialog-header">
            <div>
              <span className="sanad-kicker">KSA.MEN</span>
              <h2 id="sanad-dialog-title">{t('سند، دليلك في المنصة', 'Sanad, your platform guide')}</h2>
            </div>
            <button className="sanad-icon-control" type="button" onClick={close} data-sanad-autofocus aria-label={t('إغلاق دليل سند', 'Close Sanad guide')}>
              <X size={20} aria-hidden="true" />
            </button>
          </header>

          <div className="sanad-portrait-panel">
            <div className={`sanad-sprite sanad-sprite--${spriteFrame} ${motionEnabled && !prefersReducedMotion ? 'sanad-sprite--motion' : ''}`} role="img" aria-label={t('صورة سند الإرشادية', 'Sanad guide portrait')} />
            <span className="sanad-listening-state" aria-live="polite"><Volume2 size={16} aria-hidden="true" />{statusText}</span>
          </div>

          <div className="sanad-content">
            <section className="sanad-copy-block" aria-labelledby="sanad-current-title">
              <span className="sanad-label" id="sanad-current-title">{t('توجيهك الحالي', 'Your current guidance')}</span>
              <p>{guidance}</p>
              <p className="sanad-missing-copy">{missingGuidance}</p>
              {(context.state || context.saveStatus || context.reviewStatus) && (
                <p className="sanad-state-copy">{context.saveStatus==='saving'?t('نحفظ تعديلاتك…','Saving your changes…'):context.saveStatus==='saved'?t('تعديلاتك محفوظة.','Your changes are saved.'):t('راجع بياناتك قبل المتابعة.','Review your details before continuing.')}</p>
              )}
            </section>

            <details className="sanad-transcript">
              <summary>{t('قراءة النص الصوتي', 'Read the audio transcript')}</summary>
              <p lang={lang}>{transcript}</p>
              <small>{t('يمكنك سماع الإرشاد أو قراءته. نصيحتك الحالية تظهر أعلاه.', 'Listen or read at your own pace. Your current tip is shown above.')}</small>
            </details>

            {playerError && <p className="sanad-player-error" role="alert">{playerError}</p>}

            <div className="sanad-player-controls" aria-label={t('عناصر تشغيل تسجيل سند', 'Sanad recording controls')}>
              {playerStatus === 'playing' ? (
                <button className="sanad-control sanad-control--primary" type="button" onClick={pause}>
                  <CirclePause size={19} aria-hidden="true" />{t('إيقاف مؤقت', 'Pause')}
                </button>
              ) : (
                <button className="sanad-control sanad-control--primary" type="button" onClick={play}>
                  <CirclePlay size={19} aria-hidden="true" />{playerStatus === 'paused' ? t('متابعة', 'Resume') : t('تشغيل التسجيل', 'Play recording')}
                </button>
              )}
              <button className="sanad-control" type="button" onClick={() => stopAudio(true)} disabled={playerStatus === 'idle'}>
                <Square size={17} aria-hidden="true" />{t('إيقاف', 'Stop')}
              </button>
              <button className="sanad-control" type="button" onClick={toggleMotion} aria-pressed={motionEnabled && !prefersReducedMotion} disabled={prefersReducedMotion}>
                {motionEnabled ? <Eye size={17} aria-hidden="true" /> : <EyeOff size={17} aria-hidden="true" />}
                {prefersReducedMotion?t('الحركة مخفّضة حسب جهازك','Reduced motion on this device'):motionEnabled ? t('الحركة مفعلة', 'Motion on') : t('الحركة متوقفة', 'Motion off')}
              </button>
              <button className="sanad-control sanad-control--quiet" type="button" onClick={hideGuide}>
                <EyeOff size={17} aria-hidden="true" />{t('إخفاء', 'Hide')}
              </button>
            </div>

            <div className="sanad-dialog-footer">
              <button className="sanad-close-text" type="button" onClick={close}><RotateCcw size={16} aria-hidden="true" />{t('إغلاق والعودة للصفحة', 'Close and return to page')}</button>
              <span>{t('صوت اختياري. بياناتك لا تُرسل إلى خدمة صوتية.', 'Optional audio. Your data is never sent to a voice service.')}</span>
            </div>
          </div>
        </div>
        <audio
          ref={audioRef}
          preload="none"
          src={audioScript.src}
          onEnded={() => {
            stopAnimationLoop();
            setPlayerStatus('idle');
            setSpriteFrame('neutral');
          }}
          onPause={() => {
            if (audioRef.current && !audioRef.current.ended && playerStatus === 'playing') setPlayerStatus('paused');
          }}
          onError={() => {
            stopAnimationLoop();
            setPlayerStatus('error');
            setPlayerError(t('التسجيل غير متاح الآن. يمكنك متابعة التوجيه النصي في هذه النافذة.', 'The recording is unavailable now. You can continue with the written guidance in this window.'));
          }}
        />
      </dialog>
    </aside>
  );
}
