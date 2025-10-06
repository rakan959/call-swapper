import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';
import { registerRollupFallback } from './tools/registerRollupFallback';

registerRollupFallback();

export default mergeConfig(
  viteConfig,
  defineConfig({
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
  }),
);
