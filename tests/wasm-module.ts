import {readFileSync} from 'node:fs';
const module=new WebAssembly.Module(readFileSync('server/vendor/resvg.wasm'));
export default module;
