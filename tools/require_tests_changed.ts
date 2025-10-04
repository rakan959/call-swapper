#!/usr/bin/env ts-node

/**
 * Fails if files in src/** changed but no files in tests/** changed in this PR/commit range.
 *
 * Uses environment variables provided by GitHub Actions:
 *
 * - GITHUB_BASE_REF (on PR)
 *
 * Falls back to comparing HEAD~1..HEAD on push.
 */
import { execSync } from 'child_process';

function sh(cmd: string): string {
  return execSync(cmd, { stdio: ['pipe', 'pipe', 'inherit'] })
    .toString()
    .trim();
}

function changed(glob: string, range: string): string[] {
  const out = sh(`git diff --name-only ${range} -- ${glob} || true`);
  return out.split('\n').filter(Boolean);
}

function main() {
  const base = process.env.GITHUB_BASE_REF;
  const range = base ? `${base}...HEAD` : 'HEAD~1..HEAD';
  const srcChanged = changed('src', range).length > 0;
  const testsChanged = changed('tests', range).length > 0;

  if (srcChanged && !testsChanged) {
    console.error('Detected changes in src/** without corresponding changes in tests/**');
    process.exit(1);
  }
  console.info('PR test-change check passed.');
}

main();
