import { profilePdfSources, PROFILE_PDF_COVER, PROFILE_PDF_LOGO, type PdfImageAsset, type ProfilePdfAssets } from './profile-pdf';
import { mediaSource } from '../../shared/profile-content';

export async function pdfImageAsset(source: string, signal?: AbortSignal): Promise<PdfImageAsset> {
  if (!mediaSource(source)) throw new Error('Unsupported image source.');
  const response = await fetch(source, { credentials: 'same-origin', cache: source.startsWith('/assets/') ? 'force-cache' : 'no-store', signal });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('Image unavailable.');
  const blob = await response.blob();
  if (blob.size > 10_000_000) throw new Error('Image exceeds the export size limit.');
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const value = new Image();
      const fail = () => { value.src = ''; reject(new DOMException('Aborted', 'AbortError')); };
      const cleanup = () => signal?.removeEventListener('abort', fail);
      value.onload = () => { cleanup(); resolve(value); };
      value.onerror = () => { cleanup(); reject(new Error('Image unavailable.')); };
      if (signal?.aborted) { fail(); return; }
      signal?.addEventListener('abort', fail, { once: true }); value.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 16_000_000) throw new Error('Image dimensions exceed the export limit.');
    const scale = Math.min(1, 1600 / image.naturalWidth, 1600 / image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d'); if (!context) throw new Error('Image preparation unavailable.');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { data: canvas.toDataURL('image/jpeg', .9), width: canvas.width, height: canvas.height };
  } finally { URL.revokeObjectURL(url); }
}

export async function loadProfilePdfAssets(profile: unknown): Promise<ProfilePdfAssets> {
  const sources = profilePdfSources(profile), cache = new Map<string, Promise<PdfImageAsset>>(), unavailable: string[] = [];
  const load = (source: string) => {
    if (!cache.has(source)) cache.set(source, (async () => {
      const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), 15_000);
      try { return await pdfImageAsset(source, controller.signal); } finally { window.clearTimeout(timer); }
    })());
    return cache.get(source)!;
  };
  const fallback = async (source: string, defaultSource: string) => {
    try { return await load(source); } catch { if (source !== defaultSource) { unavailable.push(source); return load(defaultSource); } throw new Error('Brand image unavailable.'); }
  };
  const [portrait, cover] = await Promise.all([fallback(sources.portrait, PROFILE_PDF_LOGO), fallback(sources.cover, PROFILE_PDF_COVER)]);
  const evidence: Record<string, PdfImageAsset> = {};
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(3, sources.evidence.length) }, async () => {
    while (index < sources.evidence.length) {
      const source = sources.evidence[index++];
      try { evidence[source] = await load(source); } catch { unavailable.push(source); }
    }
  }));
  return { portrait, cover, evidence, unavailable };
}
