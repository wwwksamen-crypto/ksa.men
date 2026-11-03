import { describe, expect, it } from 'vitest';
import { canRestorePublishedBadge, readPublishedBadge } from '../client/src/export-offline';
describe('public badge offline copies do not override live restrictions',()=>{
 it('allows only an actually offline, published exhibition badge after a network failure',()=>{
  expect(canRestorePublishedBadge('badge',true,false,new TypeError('offline'))).toBe(true);
  expect(canRestorePublishedBadge('badge',true,true,new TypeError('network'))).toBe(false);
  expect(canRestorePublishedBadge('badge',false,false,new TypeError('offline'))).toBe(false);
  for(const kind of['pdf','ats','qr','vcard'])expect(canRestorePublishedBadge(kind,true,false,new TypeError('offline'))).toBe(false);
 });
 it('never restores on a definitive HTTP denial or server error, even when connectivity changes',()=>{for(const status of[401,403,404,409,429,500])expect(canRestorePublishedBadge('badge',true,false,{status})).toBe(false);});
 it('accepts only the matching approved public copy saved in the past day',()=>{const data={name:'local',site:'local-id',profile:{name:'هوية'},source:'published',allowed:true,translated:false};expect(readPublishedBadge(JSON.stringify({savedAt:1000,data}),'local',2000)).toEqual(data);expect(readPublishedBadge(JSON.stringify({savedAt:1000,data}),'other',2000)).toBeNull();expect(readPublishedBadge(JSON.stringify({savedAt:1000,data}),'local',1000+86400_001)).toBeNull();});
 it('rejects private drafts, legacy unversioned payloads, malformed and future-dated content',()=>{const data={name:'local',site:'local-id',profile:{name:'PRIVATE'},source:'draft',allowed:true,translated:false};for(const raw of['bad json',JSON.stringify(data),JSON.stringify({savedAt:1000,data}),JSON.stringify({savedAt:1000000,data:{...data,source:'published'}})])expect(readPublishedBadge(raw,'local',2000)).toBeNull();});
});
