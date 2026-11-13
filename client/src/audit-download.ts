import { api } from './lib';
export type AuditRow = Record<string, unknown>;
export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^\s*[=+@-]/.test(text) || /^[\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g,'""') + '"';
}
export function auditCsv(rows: AuditRow[]) {
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  return '\uFEFF' + [columns.map(csvCell).join(','),...rows.map(row => columns.map(key => csvCell(row[key])).join(','))].join('\r\n');
}
export async function downloadAudit(kind: 'audit' | 'erasure', format: 'json' | 'csv', onProgress?: (count:number)=>void) {
  const rows: AuditRow[] = []; let before: number | null = null, snapshot: number | undefined;
  const cursors = new Set<number>();
  do {
    const query = new URLSearchParams({kind,limit:'500'});
    if (snapshot !== undefined) query.set('snapshot', String(snapshot));
    if (before !== null) query.set('before', String(before));
    const page = await api<{records:AuditRow[];snapshot:number;nextBefore:number|null}>('/api/admin/audit/export?' + query);
    if (!Array.isArray(page.records) || snapshot !== undefined && page.snapshot !== snapshot) throw new Error('لم يتأكد نطاق السجل. أعد تجهيز التصدير.');
    snapshot=page.snapshot; rows.push(...page.records); onProgress?.(rows.length);
    before=page.nextBefore;
    if (before !== null) { if (!Number.isSafeInteger(before) || cursors.has(before)) throw new Error('تعذر استكمال صفحات السجل بأمان.'); cursors.add(before); }
  } while (before !== null);
  const content = format === 'csv' ? auditCsv(rows) : JSON.stringify({platform:'KSA.MEN',scope:kind,generatedAt:new Date().toISOString(),snapshot,detailsRedacted:true,hashesReferenceOriginalRows:true,records:rows},null,2);
  const blob = new Blob([content], {type:format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob), link=document.createElement('a');
  link.href=url; link.download=`ksa-men-${kind}-${new Date().toISOString().slice(0,10)}.${format}`;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  return rows.length;
}
