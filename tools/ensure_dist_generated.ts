#!/usr/bin/env ts-node

import fs from 'node:fs';
import path from 'node:path';

const distIndex = path.resolve(process.cwd(), 'dist', 'index.html');

try {
  fs.accessSync(distIndex, fs.constants.F_OK);
  console.info('dist/index.html exists.');
} catch {
  console.error('dist/index.html is missing. Run "npm run build" first.');
  process.exit(1);
}
