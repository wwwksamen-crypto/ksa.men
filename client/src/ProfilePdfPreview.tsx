import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, LoaderCircle, ZoomIn, ZoomOut } from 'lucide-react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist/types/src/display/api';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { profilePdfSections, profilePdfLinks } from './profile-pdf';
import { sanitizeProfile } from '../../shared/profile-visibility';
import { text } from '../../shared/profile-content';

type Props = { bytes: Uint8Array; profile: unknown; lang: 'ar' | 'en'; t: (ar: string, en: string) => string };

/** Renders the exact byte buffer used for download. Never regenerates a cosmetic HTML preview. */
export default function ProfilePdfPreview({ bytes, profile, lang, t }: Props) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1), [zoom, setZoom] = useState(1), [width, setWidth] = useState(320);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null), frame = useRef<HTMLDivElement>(null), render = useRef<RenderTask | null>(null);
  useEffect(() => {
    let disposed = false; let task: PDFDocumentLoadingTask | null = null;
    setDocument(null); setLoading(true); setError(''); setPage(1); setZoom(1);
    void import('pdfjs-dist/legacy/build/pdf.mjs').then(async pdfjs => {
      if (disposed) return;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false, isImageDecoderSupported: false });
      const loaded = await task.promise;
      if (disposed) { await loaded.destroy(); return; } setDocument(loaded);
    }).catch(() => { if (!disposed) { setError(t('تعذرت المعاينة. يمكنك تنزيل الملف أو إعادة تجهيزه.', 'Preview unavailable. Download the file or prepare it again.')); setLoading(false); } });
    return () => { disposed = true; render.current?.cancel(); void task?.destroy(); };
  }, [bytes, t]);
  useEffect(() => {
    if (!frame.current) return;
    const element = frame.current;
    const measure = () => setWidth(Math.max(32, element.clientWidth - 24));
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!document || !canvas.current) return;
    let disposed = false;
    const previous = render.current;
    previous?.cancel(); setLoading(true); setError('');
    const target = canvas.current;
    void (async () => {
      await previous?.promise.catch(() => undefined);
      if (disposed) return;
      const pdfPage = await document.getPage(page); if (disposed) return;
      const natural = pdfPage.getViewport({ scale: 1 });
      const scale = Math.min(1600 / natural.width, width * zoom / natural.width);
      const viewport = pdfPage.getViewport({ scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const context = target.getContext('2d'); if (!context) throw new Error('Canvas unavailable.');
      target.width = Math.ceil(viewport.width * ratio); target.height = Math.ceil(viewport.height * ratio);
      target.style.width = `${viewport.width}px`; target.style.height = `${viewport.height}px`;
      render.current = pdfPage.render({ canvas: target, canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      await render.current.promise;
      if (!disposed) { setLoading(false); pdfPage.cleanup(); }
    })().catch(cause => { if (!disposed && cause?.name !== 'RenderingCancelledException') { setLoading(false); setError(t('تعذر عرض الصفحة. يبقى الملف متاحاً للتنزيل.', 'Could not display this page. The file is still available to download.')); } });
    return () => { disposed = true; render.current?.cancel(); };
  }, [document, page, width, zoom, t]);
  const safe = sanitizeProfile(profile);
  return <section className="exports-pdf-viewer card" aria-label={t('معاينة ملف PDF', 'PDF file preview')}>
    <div className="exports-pdf-viewer__heading"><h2>{t('بروفايلك الأفقي', 'Your landscape profile')}</h2><p>{t('هذه صفحات الملف نفسه الذي ستنزله.', 'These are the pages of the same file you will download.')}</p></div>
    <div className="exports-pdf-viewer__controls" role="group" aria-label={t('تنقل صفحات الملف', 'PDF page navigation')}>
      <button type="button" onClick={() => setPage(value => Math.max(1, value - 1))} disabled={page <= 1 || !document} aria-label={t('الصفحة السابقة', 'Previous page')}><ChevronRight size={18}/></button>
      <span role="status" aria-live="polite">{document ? `${page} / ${document.numPages}` : '…'}</span>
      <button type="button" onClick={() => setPage(value => Math.min(document?.numPages || 1, value + 1))} disabled={!document || page >= document.numPages} aria-label={t('الصفحة التالية', 'Next page')}><ChevronLeft size={18}/></button>
      <button type="button" onClick={() => setZoom(value => Math.max(1, value - .5))} disabled={zoom <= 1} aria-label={t('تصغير الصفحة', 'Zoom out')}><ZoomOut size={18}/></button>
      <button type="button" onClick={() => setZoom(value => Math.min(4, value + .5))} disabled={zoom >= 4} aria-label={t('تكبير الصفحة', 'Zoom in')}><ZoomIn size={18}/></button>
    </div>
    {loading && <p role="status" className="exports-pdf-viewer__status"><LoaderCircle className="exports-spin" size={20}/>{t('نجهز الصفحة', 'Preparing page')}</p>}
    {error && <p role="alert">{error}</p>}
    <div ref={frame} className="exports-pdf-viewer__frame" tabIndex={0} aria-label={t('صفحة الملف؛ يمكنك التمرير عند التكبير', 'PDF page; scroll when zoomed')}>
      <canvas ref={canvas} role="img" aria-label={t(`معاينة الصفحة ${page}`, `Preview of page ${page}`)} hidden={!document || Boolean(error)}/>
    </div>
    <details className="exports-pdf-viewer__text"><summary>{t('قراءة محتوى الملف نصياً', 'Read profile content as text')}</summary><h3>{text(safe.name)}</h3>
      {[safe.title, safe.specialty, safe.bio, safe.city, safe.country].map((value, index) => text(value) ? <p key={index}>{text(value)}</p> : null)}
      {profilePdfSections(safe, lang).map(section => <div key={section.key}><h3>{section.heading}</h3>{section.entries.map((entry, index) => <p key={index}>{[entry.heading, entry.organization, entry.period, entry.description].filter(Boolean).join(' — ')}</p>)}</div>)}
      {profilePdfLinks(safe).map(link => <p key={link.url}><a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a></p>)}
      {text(safe.blog) && <p>{text(safe.blog)}</p>}
    </details>
  </section>;
}
