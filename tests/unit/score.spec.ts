import { describe, expect, it } from 'vitest';
import { formatScore } from '../../src/utils/score';

describe('formatScore', () => {
  it('prefixes positive values with a plus sign', () => {
    expect(formatScore(1.234, 1)).toBe('+1.2');
  });

  it('returns zero for non-finite values', () => {
    expect(formatScore(Number.NaN)).toBe('0.00');
    expect(formatScore(Number.POSITIVE_INFINITY, 0)).toBe('0');
  });

  it('formats negative and zero values without a plus', () => {
    expect(formatScore(-0.456, 2)).toBe('-0.46');
    expect(formatScore(0, 3)).toBe('0.000');
  });
});
