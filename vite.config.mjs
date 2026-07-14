import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve('web'),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5178,
    proxy: { '/api': 'http://127.0.0.1:8790' },
  },
  build: {
    outDir: path.resolve('dist'),
    emptyOutDir: true,
  },
});
