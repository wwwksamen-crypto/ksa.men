// @vitest-environment jsdom
import {beforeEach,afterEach,describe,it,expect,vi}from'vitest';
import{loadQrLogo,DEFAULT_QR_LOGO}from'../client/src/compact-qr';
let sources:string[],draw:any[],failed:Set<string>;
beforeEach(()=>{sources=[];draw=[];failed=new Set();vi.stubGlobal('Image',class{crossOrigin='';naturalWidth=200;naturalHeight=100;onload:any;onerror:any;set src(v:string){sources.push(v);queueMicrotask(()=>failed.has(v)?this.onerror?.():this.onload?.());}});vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation((()=>({fillStyle:'',fillRect:vi.fn(),drawImage:(...args:any[])=>draw.push(args),getImageData:()=>({data:new Uint8ClampedArray(96*96*4)})}))as any);});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('QR default and personal logo loader',()=>{
 it('defaults to the platform emblem, contains rather than cropping a rectangular image',async()=>{const mark=await loadQrLogo();expect(sources).toEqual([DEFAULT_QR_LOGO]);expect(mark.width).toBe(96);expect(draw[0].slice(1)).toEqual([0,24,96,48]);});
 it('uses the uploaded visible logo, and falls back to platform emblem if load or CORS fails',async()=>{await loadQrLogo('/api/media/visible-local');expect(sources).toEqual(['/api/media/visible-local']);sources=[];failed.add('/api/media/broken-local');await loadQrLogo('/api/media/broken-local');expect(sources).toEqual(['/api/media/broken-local',DEFAULT_QR_LOGO]);});
 it('does not silently produce an unbranded PNG when neither custom nor platform image can load',async()=>{failed.add('/api/media/broken-local');failed.add(DEFAULT_QR_LOGO);await expect(loadQrLogo('/api/media/broken-local')).rejects.toThrow();expect(sources).toEqual(['/api/media/broken-local',DEFAULT_QR_LOGO]);});
});
