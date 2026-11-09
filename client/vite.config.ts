import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    port: 5173,
    // Keep the browser's Host header (changeOrigin: false) so the API sees the same origin the
    // browser does — needed for the cross-site request check and for building reset links.
    proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: false } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
