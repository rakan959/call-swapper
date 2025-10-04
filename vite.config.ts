import { defineConfig } from 'vitest/config';
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
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      all: true,
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
      },
      include: ['src/engine/**/*.ts', 'src/utils/**/*.ts'],
      exclude: ['src/engine/worker.ts'],
    },
  },
});
