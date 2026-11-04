import { jsPDF, type TextOptionsLight } from 'jspdf';
import { PDFDocument, PDFName, PDFDict, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import type { ResumeContent } from './ats-content';

export type ResumeFonts = { regular: string; bold: string };
type UnicodeFontMetadata = { characterToGlyph: (codepoint: number) => number };
const isArabic = (value: string) => /[\u0600-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/u.test(value);
const presentation = /[\ufb50-\ufdff\ufe70-\ufeff]/u;

/** Map absent *isolated* presentation forms to the identical base glyph already in Tajawal. */
function printableArabic(doc: jsPDF, value: string): string {
  const metadata = doc.getFont().metadata as UnicodeFontMetadata;
  return [...doc.processArabic(value)].map(char => {
    if (metadata.characterToGlyph(char.codePointAt(0)!)) return char;
    const fallback = presentation.test(char) ? char.normalize('NFKC') : char;
    if ([...fallback].every(part => metadata.characterToGlyph(part.codePointAt(0)!))) return fallback;
    throw new Error('يوجد رمز لا يدعمه ملف PDF. يمكنك تنزيل نسخة Word أو النسخة النصية مع الاحتفاظ بالمحتوى كاملاً.');
  }).join('');
}
function utf16Hex(value: string): string {
  let result = ''; for (let i = 0; i < value.length; i++) result += value.charCodeAt(i).toString(16).padStart(4, '0'); return result;
}

/**
 * Drawing uses contextual glyphs; extraction must use base Unicode, not presentation forms.
 * Arabic ligatures expand in visual-glyph order so the reader's bidi conversion reconstructs
 * the logical word (Allah/lam-alef) instead of reversing characters within that one glyph.
 * Only this generated document's ToUnicode streams change; glyphs and source strings do not.
 */
export async function repairResumeUnicode(bytes: ArrayBuffer, lang: ResumeContent['lang']): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes);
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || object.get(PDFName.of('Subtype'))?.toString() !== '/Type0') continue;
    const reference = object.get(PDFName.of('ToUnicode'));
    if (!reference) throw new Error('تعذر تجهيز النص المقروء. يمكنك استخدام نسخة Word.');
    const stream = pdf.context.lookup(reference);
    if (!(stream instanceof PDFRawStream)) throw new Error('تعذر تجهيز النص المقروء. يمكنك استخدام نسخة Word.');
    const cmap = new TextDecoder().decode(decodePDFRawStream(stream).decode()).replace(/<([0-9a-f]{4})><([0-9a-f]{4})>/gi, (original, key: string, hex: string) => {
      const char = String.fromCharCode(Number.parseInt(hex, 16));
      if (!presentation.test(char)) return original;
      const logical = char.normalize('NFKC');
      const glyphOrder = logical.length > 1 ? [...logical].reverse().join('') : logical;
      return `<${key}><${utf16Hex(glyphOrder)}>`;
    });
    object.set(PDFName.of('ToUnicode'), pdf.context.register(pdf.context.flateStream(cmap)));
  }
  pdf.setLanguage(lang === 'ar' ? 'ar-SA' : 'en');
  return pdf.save();
}

export async function createResumePdf(resume: ResumeContent, fonts: ResumeFonts): Promise<Uint8Array> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait', putOnlyUsedFonts: true, compress: true });
  doc.addFileToVFS('Tajawal-Regular.ttf', fonts.regular); doc.addFileToVFS('Tajawal-Bold.ttf', fonts.bold);
  doc.addFont('Tajawal-Regular.ttf', 'Tajawal', 'normal'); doc.addFont('Tajawal-Bold.ttf', 'Tajawal', 'bold');
  doc.setFont('Tajawal', 'normal'); doc.setR2L(false); doc.setTextColor(17, 17, 17);
  doc.setProperties({ title: `${resume.name} — Resume`, author: 'KSA.MEN', subject: 'Professional résumé', creator: 'KSA.MEN' });
  // Instance-only hook: no changes to jsPDF globals or to the landscape PDF generator.
  doc.internal.events.subscribe('preProcessText', (args: { text: Array<string | [string, number, number]> }) => {
    args.text = args.text.map(row => Array.isArray(row) ? [printableArabic(doc, row[0]), row[1], row[2]] : printableArabic(doc, row));
  });
  const margin = 42, pageWidth = doc.internal.pageSize.getWidth(), pageHeight = doc.internal.pageSize.getHeight(), width = pageWidth - margin * 2;
  let y = margin;
  const measure = (value: string) => doc.getTextWidth(printableArabic(doc, value));
  const wrap = (value: string): string[] => {
    const lines: string[] = [];
    for (const paragraph of value.split(/\r?\n/u)) {
      let line = '';
      for (const word of paragraph.split(/\s+/u).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (measure(candidate) <= width) { line = candidate; continue; }
        if (line) { lines.push(line); line = ''; }
        // Break only overlong tokens, by grapheme rather than UTF-16 code units.
        if (measure(word) > width) {
          for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word)) {
            if (line && measure(line + segment) > width) { lines.push(line); line = ''; }
            line += segment;
          }
        } else line = word;
      }
      lines.push(line);
    }
    return lines;
  };
  const fits = (height: number) => { if (y + height > pageHeight - margin) { doc.addPage(); y = margin; } };
  type BidiOptions = { isInputVisual: boolean; isOutputVisual: boolean; isInputRtl: boolean; isOutputRtl: boolean; isSymmetricSwapping: boolean };
  type BidiEngine = { doBidiReorder: (value: string, mapping: number[], levels: number[]) => string };
  const engineFactory = (jsPDF as unknown as { __bidiEngine__: new (options: BidiOptions) => BidiEngine }).__bidiEngine__;
  const drawLogicalLine = (line: string) => {
    const shaped = printableArabic(doc, line), mapping: number[] = [], levels: number[] = [];
    const engine = new engineFactory({ isInputVisual: false, isOutputVisual: true, isInputRtl: isArabic(line), isOutputRtl: false, isSymmetricSwapping: true });
    const visual = engine.doBidiReorder(shaped, mapping, levels);
    const left = resume.lang === 'ar' ? pageWidth - margin - measure(line) : margin;
    // Write directional spans in original logical order, while placing them in visual bidi order.
    // A reader sees separate Arabic/Latin items, not a majority-Latin paragraph to guess/reverse.
    for (let start = 0; start < shaped.length;) {
      let end = start + 1; while (end < shaped.length && levels[end] === levels[start]) end++;
      const indices = mapping.map((source, index) => source >= start && source < end ? index : -1).filter(index => index >= 0);
      const position = Math.min(...indices);
      const options: TextOptionsLight = { align: 'left', baseline: 'top', isInputVisual: false, isOutputVisual: true, isInputRtl: levels[start] % 2 === 1, isOutputRtl: false };
      doc.text(shaped.slice(start, end), left + doc.getTextWidth(visual.slice(0, position)), y, options);
      start = end;
    }
  };
  for (const [blockIndex, block] of resume.blocks.entries()) {
    const bold = ['name', 'role', 'heading', 'entry'].includes(block.kind);
    const size = block.kind === 'name' ? 21 : block.kind === 'role' ? 12 : block.kind === 'heading' ? 12 : block.kind === 'contact' ? 10 : 11;
    doc.setFont('Tajawal', bold ? 'bold' : 'normal'); doc.setFontSize(size);
    const leading = size * 1.45, lines = wrap(block.text), gap = block.kind === 'heading' ? 12 : block.kind === 'entry' ? 6 : 3;
    if (block.keepNext && !resume.blocks[blockIndex - 1]?.keepNext) {
      let reserve = 0;
      for (let index = blockIndex; index < resume.blocks.length; index++) {
        const next = resume.blocks[index];
        const nextBold = ['name', 'role', 'heading', 'entry'].includes(next.kind);
        const nextSize = next.kind === 'name' ? 21 : next.kind === 'role' || next.kind === 'heading' ? 12 : next.kind === 'contact' ? 10 : 11;
        const nextGap = next.kind === 'heading' ? 12 : next.kind === 'entry' ? 6 : 3;
        doc.setFont('Tajawal', nextBold ? 'bold' : 'normal'); doc.setFontSize(nextSize);
        const count = wrap(next.text).length;
        reserve += nextGap + nextSize * 1.45 * (next.keepNext ? count : Math.min(count, 2));
        if (!next.keepNext) break;
      }
      doc.setFont('Tajawal', bold ? 'bold' : 'normal'); doc.setFontSize(size);
      fits(Math.min(reserve, pageHeight - 2 * margin));
    } else fits(leading + gap);
    y += gap;
    for (const line of lines) {
      fits(leading);
      if (line) {
        drawLogicalLine(line);
        if (block.link) { const textWidth = measure(line); doc.link(resume.lang === 'ar' ? pageWidth - margin - textWidth : margin, y, textWidth, leading, { url: block.link }); }
      }
      y += leading;
    }
  }
  return repairResumeUnicode(doc.output('arraybuffer'), resume.lang);
}

let fontPromise: Promise<ResumeFonts> | null = null;
export function loadResumeFonts(): Promise<ResumeFonts> {
  if (!fontPromise) {
    const base64 = async (path: string) => {
      const response = await fetch(path, { credentials: 'same-origin', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error('تعذر تحميل خط السيرة. حاول مجدداً.');
      const bytes = new Uint8Array(await response.arrayBuffer()); let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return btoa(binary);
    };
    fontPromise = Promise.all([base64('/assets/Tajawal-Regular.ttf'), base64('/assets/Tajawal-Bold.ttf')]).then(([regular, bold]) => ({ regular, bold })).catch(error => { fontPromise = null; throw error; });
  }
  return fontPromise;
}
