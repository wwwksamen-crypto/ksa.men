import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],build:{outDir:'dist/client',emptyOutDir:true,rollupOptions:{output:{manualChunks:{react:['react','react-dom'],qr:['qrcode'],pdf:['pdfmake/build/pdfmake']}}}}});
