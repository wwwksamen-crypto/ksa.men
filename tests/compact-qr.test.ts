import { describe, expect, it } from 'vitest';
import { decode } from 'fast-png';
import QRCode from 'qrcode';
import { compactQrPng, contactQrPayload } from '../client/src/compact-qr';
import { generateVCard } from '../client/src/vcard';
import { writeFileSync } from 'node:fs';
describe('Lightweight lossless QR PNG — local encoder only',()=>{
 it('retains exact module pixels, four-module white margin, a small PNG and no anti-aliasing',async()=>{
  const payload='https://pro.ksa.men';const result=await compactQrPng(payload);const png=decode(result.bytes);const matrix=QRCode.create(payload,{errorCorrectionLevel:'H'}).modules;
  expect(result.bytes[0]).toBe(137);expect(png.width).toBe(result.width);expect(result.width%result.scale).toBe(0);expect(result.quiet).toBe(4);expect(result.bytes.length).toBeLessThan(20000);
  for(let row=0;row<result.cells;row++)for(let col=0;col<result.cells;col++){
   const offset=(((row+4)*result.scale)*png.width+(col+4)*result.scale)*3;expect(png.data[offset]).toBe(matrix.data[row*result.cells+col]?0:255);expect(png.data[offset+1]).toBe(matrix.data[row*result.cells+col]?68:255);
  }
  for(let i=0;i<result.width*result.scale*4*3;i++)expect(png.data[i]).toBe(255);
  writeFileSync('/home/ubuntu/ksa-men-checkpoints/social-qr-20261108/qr-site-local.png',result.bytes);
 });
 it('uses essential contact data in QR, never hidden/private data, while the full VCF retains the bio',async()=>{
  const profile={name:'اختبار محلي',email:'local@example.test',phone:'0500000000',bio:'نبذة طويلة'.repeat(2000),notes:'PRIVATE',hidden:['phone']};const before=JSON.stringify(profile);const payload=contactQrPayload(profile,'local','https://local.ksa.men');
  expect(payload).toContain('BEGIN:VCARD');expect(payload).toContain('اختبار محلي');expect(payload).toContain('EMAIL');expect(payload).not.toContain('0500000000');expect(payload).not.toContain('NOTE:');expect(payload).not.toContain('PRIVATE');expect(generateVCard(profile,'local','https://local.ksa.men')).toContain('NOTE:');expect(JSON.stringify(profile)).toBe(before);
  const result=await compactQrPng(payload);expect(result.bytes.length).toBeLessThan(30000);writeFileSync('/home/ubuntu/ksa-men-checkpoints/social-qr-20261108/qr-contact-local.png',result.bytes);writeFileSync('/home/ubuntu/ksa-men-checkpoints/social-qr-20261108/qr-contact-payload-local.txt',payload);
 });
 it('rejects empty payloads rather than downloading a misleading placeholder',async()=>{await expect(compactQrPng('')).rejects.toThrow();});
});
