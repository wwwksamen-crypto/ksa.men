import { readFileSync } from 'node:fs';
const module = new WebAssembly.Module(readFileSync('server/vendor/webp-dec.wasm'));
export default module;
