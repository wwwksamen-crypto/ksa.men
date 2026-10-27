import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
export default defineConfig({resolve:{alias:[{find:/^.*vendor\/resvg\.wasm$/,replacement:fileURLToPath(new URL('./tests/wasm-module.ts',import.meta.url))}]},test:{testTimeout:20000,hookTimeout:30000}});
