import {describe,it,expect} from 'vitest';
import worker from '../server/index';
describe('static asset response preservation',()=>{
 for(const status of [200,206,304,404])it(`preserves ${status} for a conditional image request`,async()=>{
  let seen:Request|undefined;
  const env:any={ROOT_DOMAIN:'ksa.men',ASSETS:{fetch:async(req:Request)=>{seen=req;return new Response(status===304?null:'image-bytes',{status,headers:{'Content-Type':'image/webp','ETag':'"image-v1"'}});}}};
  const request=new Request('https://ksa.men/assets/test-image.webp',{headers:{'If-None-Match':'"image-v1"'}});
  const response=await worker.fetch(request,env,{} as any);
  expect(response.status).toBe(status);expect(response.headers.get('ETag')).toBe('"image-v1"');expect(seen?.headers.get('If-None-Match')).toBe('"image-v1"');
  expect(response.headers.get('Cache-Control')).toBe(status===404?'private, no-store':'public, max-age=3600');
  if(status===304)expect(await response.text()).toBe('');
 });
});
