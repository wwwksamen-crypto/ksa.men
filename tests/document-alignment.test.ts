import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { safeUser, appendAudit } from '../server/core';
import { usageMetricsEnabled } from '../server/optional-metrics';
import { businessApproach } from '../shared/business-approach';

const source=(p:string)=>readFileSync(p,'utf8');
describe('Institutional business approach alignment — local only',()=>{
  it('publishes the original PDFs byte-for-byte with correctly labelled downloadable documents',()=>{
    const hashes = {
      ar: createHash('sha256').update(readFileSync('public'+businessApproach.documents.ar.path)).digest('hex'),
      en: createHash('sha256').update(readFileSync('public'+businessApproach.documents.en.path)).digest('hex'),
    };
    expect(hashes.ar).toBe('1b4eed57ac64390a8f2d65c4fa3922418204eead94f87c6222ca9fcb8d1f1dea');
    expect(hashes.en).toBe('9aa63e3d7aba59e8504d028cc6af7952da7345f024923f98018ddeb91a858a04');
    for(const locale of ['ar','en'] as const){
      expect(readFileSync('public'+businessApproach.documents[locale].path).subarray(0,5).toString()).toBe('%PDF-');
      expect(businessApproach.documents[locale].filename).toContain(locale==='ar'?'Arabic':'English');
    }
    expect(businessApproach.copy.ar.description).toContain('ليس');
    expect(source('client/src/main.tsx')).toContain('<BusinessApproach/>');
    expect(source('server/seo.ts')).toContain("path==='/about'");
    expect(source('server/index.ts')).toContain("c.header('Content-Disposition',`attachment;");
  });
  it('projects only justified account response fields and fails closed for new secret/internal fields',()=>{
    const out=safeUser({id:7,email:'local@unit.invalid',name:'محلي',whatsapp:'',role:'user',financial:0,status:'active',trial_until:1,entitlement_until:2,balance:1000,account:'local',pin_hash:'never expose',access_token:'never expose',csrf:'never expose',future_secret:'never expose',internal_notes:'never expose',referrer_id:9});
    expect(out).toMatchObject({id:7,name:'محلي',balance:1000,account:'local'});
    expect(Object.keys(out!)).not.toContain('pin_hash');
    expect(JSON.stringify(out)).not.toContain('never expose');
    expect(Object.keys(out!)).not.toContain('referrer_id');
    expect(safeUser(null)).toBeNull();expect(safeUser([])).toBeNull();
  });
  it('redacts raw network identifiers and secrets from new audit details without breaking append-only linkage',async()=>{
    const statements:Array<{sql:string;args:unknown[]}>=[];
    const env:any={AUTH_SECRET:'LOCAL-TEST-ONLY',DB:{prepare:(sql:string)=>({args:[] as unknown[],sql,bind(...args:unknown[]){this.args=args;return this;},first:async()=>({last_hash:'local-anchor',last_audit_id:3})}),batch:async(items:Array<{sql:string;args:unknown[]}>)=>{statements.push(...items);return [{meta:{changes:1}},{meta:{changes:1}}];}}};
    await appendAudit(env,7,'local.alignment','local',{email:'local@unit.invalid',client_ip:'198.51.100.90',ipAddress:'198.51.100.91',access_token:'never-record-token',pin_hash:'never-record-hash',csrf:'never-record-csrf',nested:{api_key:'never-record-key'},siteCount:2});
    const detail=String(statements[0].args[3]);
    expect(detail).not.toContain('never-record');expect(detail).not.toContain('198.51.100');expect(detail).not.toContain('local@unit.invalid');
    expect(JSON.parse(detail)).toMatchObject({client_ip:{redacted:true},siteCount:2});expect(statements[0].sql).toContain('INSERT INTO audit');expect(statements[1].sql).toContain('UPDATE audit_chain_state');
  });
  it('keeps optional metrics off unless a purpose and a current owner decision are present',async()=>{
    const context=(value:unknown,owner=true):any=>({env:{DB:{prepare:(sql:string)=>({bind(){return this;},all:async()=>({results:value===undefined?[]:[{key:'optional_usage_metrics',value:JSON.stringify(value)}]}),first:async()=>owner?{id:1}:null})}}});
    expect(await usageMetricsEnabled(context(undefined))).toBe(false);
    expect(await usageMetricsEnabled(context(true))).toBe(false);
    expect(await usageMetricsEnabled(context({enabled:true}))).toBe(false);
    const decision={enabled:true,purpose:'Local test aggregate purpose',approvedBy:1,approvedAt:1700000000};
    expect(await usageMetricsEnabled(context(decision,false))).toBe(false);
    expect(await usageMetricsEnabled(context(decision))).toBe(true);
  });
});
