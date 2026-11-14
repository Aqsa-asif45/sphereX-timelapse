/// <reference types="vitest" />
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The FastAPI backend (backend/) runs on 8010; in development Vite proxies /api to it.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5174, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:8010', changeOrigin: false } } },
  preview: { port: 5175, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:8010', changeOrigin: false } } },
  build: { outDir: 'dist', sourcemap: true, target: 'es2022' },
  test: { environment: 'jsdom', setupFiles: './src/test/setup.ts', css: false },
});
