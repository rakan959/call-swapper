/**
 * @req: N-004
 * @req: N-005
 * @req: N-006
 * @req: N-007
 */
import { describe, expect, it, test } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';

type CiWorkflow = {
  jobs?: Record<
    string,
    {
      steps?: Array<{
        run?: unknown;
      }>;
    }
  >;
};

const workflowPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../.github/workflows/ci.yml',
);

describe('quality gates parity', () => {
  it('enforces CI quality gates', () => {
    const raw = readFileSync(workflowPath, 'utf8');
    const parsed = yaml.parse(raw) as CiWorkflow;

    const steps = parsed.jobs?.['build-test']?.steps ?? [];
    const commands = steps
      .map((step) => (typeof step?.run === 'string' ? step.run.trim() : null))
      .filter((value): value is string => Boolean(value));

    const expected = [
      'npm run fmt:check',
      'npm run lint',
      'npm run typecheck',
      'npm run test:cov',
      'npm run check:pr',
      'npm run build',
      'npm run check:dist',
    ];

    expected.forEach((command) => {
      expect(commands).toContain(command);
    });
  });
});

/**
 * @req: N-003
 */
test.todo(
  'Ensure accessibility contrast and keyboard navigation is covered by automated checks or audits.',
);
