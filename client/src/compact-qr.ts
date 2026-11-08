import { generateVCard } from './vcard';

export const DEFAULT_QR_LOGO = '/assets/logo-emblem.webp';
export type QrLogoPixels = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };

export function contactQrPayload(profile: Record<string, unknown>, name: string, url: string): string {
  // QR contact cards carry essential fields; long notes remain in the full .vcf.
  const essential = { ...profile }; delete essential.bio;
  return generateVCard(essential, name, url);
}

/** A bounded, contained thumbnail. A failed custom image never yields an unbranded download. */
export async function loadQrLogo(source = DEFAULT_QR_LOGO): Promise<QrLogoPixels> {
  const load = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(); image.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => { image.onload = null; image.onerror = null; reject(new Error('QR logo unavailable')); }, 10000);
    image.onload = () => { window.clearTimeout(timer); image.naturalWidth && image.naturalHeight ? resolve(image) : reject(new Error('QR logo unavailable')); };
    image.onerror = () => { window.clearTimeout(timer); reject(new Error('QR logo unavailable')); };
    image.src = url;
  });
  const raster = async (url: string): Promise<QrLogoPixels> => {
    const image = await load(url), size = 96;
    const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
    const context = canvas.getContext('2d'); if (!context) throw new Error('QR image unavailable');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, size, size);
    const ratio = Math.min(size / image.naturalWidth, size / image.naturalHeight);
    const w = image.naturalWidth * ratio, h = image.naturalHeight * ratio;
    context.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
    return { width: size, height: size, data: context.getImageData(0, 0, size, size).data };
  };
  try { return await raster(source || DEFAULT_QR_LOGO); }
  catch (cause) { if (source && source !== DEFAULT_QR_LOGO) return raster(DEFAULT_QR_LOGO); throw cause; }
}

export async function compactQrPng(payload: string, logo?: QrLogoPixels) {
  const [module, png] = await Promise.all([import('qrcode'), import('fast-png')]); const QR = module.default ?? module;
  let code: ReturnType<typeof QR.create> | undefined;
  for (const level of ['H', 'Q', 'M'] as const) { try { code = QR.create(payload, { errorCorrectionLevel: level }); break; } catch {} }
  if (!code) throw new Error('تعذر ترميز البيانات؛ استخدم ملف جهة الاتصال.');
  const cells = code.modules.size, quiet = 4, scale = Math.max(6, Math.ceil(384 / (cells + quiet * 2))), width = (cells + quiet * 2) * scale;
  const pixels = new Uint8Array(width * width * 3); pixels.fill(255);
  for (let row = 0; row < cells; row++) for (let col = 0; col < cells; col++) if (code.modules.data[row * cells + col]) for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
    const offset = (((row + quiet) * scale + y) * width + (col + quiet) * scale + x) * 3;
    pixels[offset] = 0; pixels[offset + 1] = 68; pixels[offset + 2] = 34;
  }
  let logoBounds: { x: number; y: number; size: number; inset: number } | undefined;
  if (logo) {
    if (!Number.isInteger(logo.width) || !Number.isInteger(logo.height) || logo.width < 1 || logo.height < 1 || logo.data.length !== logo.width * logo.height * 4) throw new Error('QR logo unavailable');
    let plateCells = Math.max(3, Math.min(15, Math.floor(cells * 0.25))); if (plateCells % 2 === 0) plateCells--;
    const size = plateCells * scale, x = ((cells - plateCells) / 2 + quiet) * scale, inset = Math.max(3, Math.round(scale * 0.55)), inner = size - inset * 2;
    logoBounds = { x, y: x, size, inset };
    for (let row = x; row < x + size; row++) pixels.fill(255, (row * width + x) * 3, (row * width + x + size) * 3);
    for (let row = 0; row < inner; row++) for (let col = 0; col < inner; col++) {
      const sy = Math.min(logo.height - 1, Math.floor(row * logo.height / inner)), sx = Math.min(logo.width - 1, Math.floor(col * logo.width / inner));
      const from = (sy * logo.width + sx) * 4, to = ((x + inset + row) * width + x + inset + col) * 3, alpha = logo.data[from + 3] / 255;
      for (let channel = 0; channel < 3; channel++) pixels[to + channel] = Math.round(logo.data[from + channel] * alpha + 255 * (1 - alpha));
    }
  }
  const bytes = png.encode({ width, height: width, channels: 3, depth: 8, data: pixels }, { zlib: { level: 9 } });
  return { bytes, width, cells, scale, quiet, logoBounds, mime: 'image/png' as const };
}

export async function downloadCompactQr(payload: string, filename: string, centerImage = DEFAULT_QR_LOGO) {
  const logo = await loadQrLogo(centerImage), { bytes } = await compactQrPng(payload, logo);
  const copy = new Uint8Array(bytes.length); copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: 'image/png' }), url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000); return bytes.length;
}
