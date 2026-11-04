import decodeWebp, { init as initWebp } from '@jsquash/webp/decode.js';
import { encode as encodePng } from 'fast-png';
import webpWasm from './vendor/webp-dec.wasm';

let ready: Promise<void> | undefined;
/** Bound the decoded allocation before passing untrusted bytes to the WASM codec. */
export function webpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
  if (bytes.length < 20 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return null;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset + 4, true), start = offset + 8;
    if (start + size > bytes.length) return null;
    let width = 0, height = 0;
    if (tag(offset) === 'VP8X' && size >= 10) {
      if (bytes[start] & 2) return null; // No animated public identity previews.
      width = 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16);
      height = 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16);
    } else if (tag(offset) === 'VP8L' && size >= 5 && bytes[start] === 0x2f) {
      const bits = view.getUint32(start + 1, true);
      width = 1 + (bits & 0x3fff); height = 1 + ((bits >>> 14) & 0x3fff);
    } else if (tag(offset) === 'VP8 ' && size >= 10 && bytes[start + 3] === 0x9d && bytes[start + 4] === 1 && bytes[start + 5] === 0x2a) {
      width = view.getUint16(start + 6, true) & 0x3fff; height = view.getUint16(start + 8, true) & 0x3fff;
    }
    if (width && height) return width <= 3200 && height <= 3200 && width * height <= 4_000_000 ? { width, height } : null;
    offset = start + size + (size % 2);
  }
  return null;
}
function boundedJpeg(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 2; offset + 4 <= bytes.length;) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) return false;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) return false;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    if (length >= 8 && [0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      const height = view.getUint16(offset + 3), width = view.getUint16(offset + 5);
      return width > 0 && height > 0 && width <= 3200 && height <= 3200 && width * height <= 4_000_000;
    }
    offset += length;
  }
  return false;
}
export async function shareImageData(bytes: Uint8Array, mime: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (!bytes.length || bytes.length > 5_000_000) return null;
  if (mime === 'image/png' && bytes.length >= 24 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(16) * view.getUint32(20) > 4_000_000) return null;
    return { bytes, mime };
  }
  if (mime === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && boundedJpeg(bytes)) return { bytes, mime };
  if (mime !== 'image/webp' || !webpDimensions(bytes)) return null;
  ready ||= initWebp(webpWasm);
  await ready;
  const source = bytes.slice().buffer as ArrayBuffer;
  const decoded = await decodeWebp(source);
  return { bytes: encodePng({ width: decoded.width, height: decoded.height, data: new Uint8Array(decoded.data.buffer), channels: 4, depth: 8 }), mime: 'image/png' };
}
