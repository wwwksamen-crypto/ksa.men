import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { decode } from 'fast-png';
import QRCode from 'qrcode';
import { compactQrPng, contactQrPayload } from '../client/src/compact-qr';
const base='/home/ubuntu/ksa-men-checkpoints/branded-qr-20261108/';
const logo={width:96,height:96,data:new Uint8Array(readFileSync(base+'logo.rgba'))};
describe('Centered branded light QR — local raster only',()=>{
 it('places the real default emblem centrally, keeps all external QR cells and finder patterns intact',async()=>{
  const payload='https://ceo.ksa.men',result=await compactQrPng(payload,logo),baseCode=QRCode.create(payload,{errorCorrectionLevel:'H'}).modules,png=decode(result.bytes),box=result.logoBounds!;
  expect(box).toBeDefined();expect(box.x+box.size/2).toBe(result.width/2);expect(box.size).toBeLessThan(result.width*0.25);expect(result.bytes.length).toBeLessThan(40000);
  for(let row=0;row<result.cells;row++)for(let col=0;col<result.cells;col++){
   const y=(row+4)*result.scale,x=(col+4)*result.scale;if(x>=box.x&&x<box.x+box.size&&y>=box.y&&y<box.y+box.size)continue;
   const offset=(y*result.width+x)*3;expect(png.data[offset]).toBe(baseCode.data[row*result.cells+col]?0:255);expect(png.data[offset+1]).toBe(baseCode.data[row*result.cells+col]?68:255);
  }
  for(let i=0;i<result.width*result.scale*4*3;i++)expect(png.data[i]).toBe(255);
  const colors=new Set<string>();for(let y=box.y+box.inset;y<box.y+box.size-box.inset;y++)for(let x=box.x+box.inset;x<box.x+box.size-box.inset;x++){const n=(y*result.width+x)*3;colors.add([png.data[n],png.data[n+1],png.data[n+2]].join(','));}expect(colors.size).toBeGreaterThan(8);
  writeFileSync(base+'branded-site-local.png',result.bytes);
 });
 it('keeps contact fields, marks and PNG light for contact and dense symbols',async()=>{
  const payload=contactQrPayload({name:'فحص شعار محلي',email:'local@example.test',bio:'PRIVATE'.repeat(1000)},'local','https://local.ksa.men');const result=await compactQrPng(payload,logo);expect(result.logoBounds).toBeDefined();expect(result.bytes.length).toBeLessThan(45000);writeFileSync(base+'branded-vcard-local.png',result.bytes);writeFileSync(base+'branded-vcard-payload-local.txt',payload);
  const dense='DENSE-LOCAL-'.repeat(150);const large=await compactQrPng(dense,logo);expect(large.bytes.length).toBeLessThan(60000);writeFileSync(base+'branded-dense-local.png',large.bytes);writeFileSync(base+'branded-dense-payload-local.txt',dense);
 });
 it('uses custom pixels, composites transparency to white and rejects invalid logo data',async()=>{
  const custom=new Uint8Array(4*4*4);for(let i=0;i<custom.length;i+=4){custom.set([160,20,200,255],i);}const result=await compactQrPng('https://ceo.ksa.men',{width:4,height:4,data:custom});const im=decode(result.bytes),mid=Math.floor(result.width/2),at=(mid*result.width+mid)*3;expect([...im.data.slice(at,at+3)]).toEqual([160,20,200]);
  custom.fill(0);const transparent=decode((await compactQrPng('https://ceo.ksa.men',{width:4,height:4,data:custom})).bytes);expect([...transparent.data.slice(at,at+3)]).toEqual([255,255,255]);await expect(compactQrPng('https://ceo.ksa.men',{width:4,height:4,data:new Uint8Array(3)})).rejects.toThrow();
 });
});
