import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const webPort = Number(process.env.NOVEL_STUDIO_WEB_PORT ?? 5178);
const apiProxy = process.env.NOVEL_STUDIO_API_PROXY ?? 'http://127.0.0.1:8790';

export default defineConfig({
  root: path.resolve('web'),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: webPort,
    strictPort: true,
    proxy: { '/api': apiProxy },
  },
  build: {
    outDir: path.resolve('dist'),
    emptyOutDir: true,
  },
});
