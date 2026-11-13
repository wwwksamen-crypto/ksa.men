import type {Ctx} from './core';
import {HTTPException} from 'hono/http-exception';
import {decodeValidatedWebp} from './share-image';

export const MAX_UPLOAD_REQUEST=8*1024*1024+256*1024;
/** Enforce actual streamed bytes, not only an untrusted Content-Length. */
export async function boundedUploadForm(c:Ctx):Promise<FormData>{
 const declared=c.req.header('Content-Length');
 if(declared && Number(declared)>MAX_UPLOAD_REQUEST)throw new HTTPException(413,{message:'حجم الطلب يتجاوز الحد المسموح'});
 const reader=c.req.raw.body?.getReader();
 if(!reader)throw new HTTPException(400,{message:'اختر الملف'});
 const chunks:Uint8Array[]=[];let length=0;
 try{
  while(true){const item=await reader.read();if(item.done)break;length+=item.value.byteLength;
   if(length>MAX_UPLOAD_REQUEST){await reader.cancel().catch(()=>{});throw new HTTPException(413,{message:'حجم الطلب يتجاوز الحد المسموح'});}
   chunks.push(item.value);
  }
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return await new Response(bytes,{headers:{'Content-Type':c.req.header('Content-Type')||''}}).formData();}
 catch{throw new HTTPException(400,{message:'تعذر قراءة ملف الرفع'});}
}
export async function validateIdentityWebp(bytes:Uint8Array):Promise<void>{
 if(bytes.length<20)throw new HTTPException(400,{message:'اختر صورة WebP كاملة وصالحة'});
 const declared=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(4,true);
 if(declared!==bytes.length-8)throw new HTTPException(400,{message:'بنية الصورة غير مكتملة'});
 try{if(!await decodeValidatedWebp(bytes))throw Error('Invalid image');}
 catch{throw new HTTPException(400,{message:'تعذر فك الصورة أو تجاوزت أبعادها الحد المسموح'});}
}
