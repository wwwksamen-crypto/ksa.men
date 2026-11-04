export type PdfInlineText = string | Array<{ text: string }>;

/** Wrap logical lines first; reorder Arabic word runs per line, preserving LTR phrases. */
export function pdfText(value: string, rtl: boolean, width = 500, size = 10.5): PdfInlineText {
  if (!rtl || !/[\u0600-\u06ff]/u.test(value)) return value;
  const canvas=document.createElement('canvas');const measure=canvas.getContext('2d');
  if(measure)measure.font=`${size}px Tajawal`;
  const lines:string[]=[];
  for(const paragraph of value.split(/\r?\n/)){
    let line='';
    for(const word of paragraph.trim().split(/\s+/u).filter(Boolean)){
      const candidate=line?line+' '+word:word;
      if(line&&measure&&measure.measureText(candidate).width>width){lines.push(line);line=word;}else line=candidate;
    }
    lines.push(line);
  }
  return lines.flatMap((line,lineIndex)=>{
    const runs:Array<{text:string,latin:boolean}>=[];
    for(const word of line.split(/\s+/u).filter(Boolean)){
      const latin=!/[\u0600-\u06ff]/u.test(word);const last=runs[runs.length-1];
      if(latin&&last?.latin)last.text+=' '+word;else runs.push({text:word,latin});
    }
    const output=runs.reverse().flatMap((run,index)=>index?[{text:' '},{text:run.text}]:[{text:run.text}]);
    if(lineIndex<lines.length-1)output.push({text:'\n'});return output;
  });
}

