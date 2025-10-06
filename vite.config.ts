import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const ghPagesBase = process.env.GH_PAGES_BASE?.trim();
const base = (() => {
  if (!ghPagesBase) {
    return '/';
  }
  const trimmed = ghPagesBase.replace(/^\/+/, '').replace(/\/+$/, '');
  return trimmed.length > 0 ? `/${trimmed}/` : '/';
})();

// Build to /dist for GitHub Pages and allow runtime base override via GH_PAGES_BASE.
export default defineConfig({
  plugins: [react()],
  base,
  resolve: {
    alias: {
      '@domain': path.resolve(rootDir, 'src/domain'),
      '@engine': path.resolve(rootDir, 'src/engine'),
      '@utils': path.resolve(rootDir, 'src/utils'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
