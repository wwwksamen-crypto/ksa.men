import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type { ResumeContent } from './ats-content';

export async function createResumeDocx(resume: ResumeContent): Promise<Uint8Array> {
  const rtl = resume.lang === 'ar';
  const document = new Document({
    creator: 'KSA.MEN', title: `${resume.name} — Resume`, description: 'Professional résumé',
    styles: { default: { document: { run: { font: 'Tajawal', size: 22, language: { value: rtl ? 'ar-SA' : 'en-US', bidirectional: 'ar-SA' } }, paragraph: { spacing: { after: 80, line: 300 } } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 840, bottom: 840, left: 840, right: 840 } } }, children: resume.blocks.map(block => new Paragraph({
      bidirectional: rtl, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      keepNext: block.keepNext, widowControl: true,
      heading: block.kind === 'name' ? HeadingLevel.TITLE : block.kind === 'heading' ? HeadingLevel.HEADING_1 : undefined,
      spacing: { before: block.kind === 'heading' ? 180 : 0, after: 80 },
      children: block.text.split(/\r?\n/).flatMap((line, index) => [new TextRun({ text: line, ...(index ? { break: 1 } : {}), font: 'Tajawal', rightToLeft: /[\u0600-\u08ff]/.test(line), bold: ['name', 'role', 'heading', 'entry'].includes(block.kind), color: '111111', size: block.kind === 'name' ? 42 : block.kind === 'heading' ? 26 : 22 })]),
    })) }],
  });
  return new Uint8Array(await Packer.toArrayBuffer(document));
}
