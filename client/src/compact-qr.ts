import { generateVCard } from './vcard';
export function contactQrPayload(profile:Record<string,unknown>,name:string,url:string):string {
 // QR contact cards carry essential fields; long notes remain in the full .vcf.
 const essential={...profile};delete essential.bio;
 return generateVCard(essential,name,url);
}
export async function compactQrPng(payload:string) {
 const [module,png]=await Promise.all([import('qrcode'),import('fast-png')]);const QR=module.default??module;
 let code:ReturnType<typeof QR.create>|undefined;
 for(const level of ['H','Q','M'] as const){try{code=QR.create(payload,{errorCorrectionLevel:level});break;}catch{}}
 if(!code)throw new Error('تعذر ترميز البيانات؛ استخدم ملف جهة الاتصال.');
 const cells=code.modules.size,quiet=4,scale=Math.max(6,Math.ceil(384/(cells+quiet*2))),width=(cells+quiet*2)*scale;
 const pixels=new Uint8Array(width*width*3);pixels.fill(255);
 for(let row=0;row<cells;row++)for(let col=0;col<cells;col++)if(code.modules.data[row*cells+col])for(let y=0;y<scale;y++)for(let x=0;x<scale;x++){
  const offset=(((row+quiet)*scale+y)*width+(col+quiet)*scale+x)*3;pixels[offset]=0;pixels[offset+1]=68;pixels[offset+2]=34;
 }
 const bytes=png.encode({width,height:width,channels:3,depth:8,data:pixels},{zlib:{level:9}});
 return {bytes,width,cells,scale,quiet,mime:'image/png' as const};
}
export async function downloadCompactQr(payload:string,filename:string) {
 const {bytes}=await compactQrPng(payload);const copy=new Uint8Array(bytes.length);copy.set(bytes);const blob=new Blob([copy.buffer],{type:'image/png'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);return bytes.length;
}
