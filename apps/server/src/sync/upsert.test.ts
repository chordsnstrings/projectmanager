import { describe, expect, it } from 'vitest';
import { parseEstimateFromLabels } from './upsert';

describe('parseEstimateFromLabels', () => {
  it('parses hours', () => {
    expect(parseEstimateFromLabels(['bug', 'est:3h'])).toBe(180);
  });
  it('parses days as 8h each', () => {
    expect(parseEstimateFromLabels(['est:2d'])).toBe(2 * 8 * 60);
  });
  it('parses fractional hours', () => {
    expect(parseEstimateFromLabels(['est:1.5h'])).toBe(90);
  });
  it('returns null when no estimate label', () => {
    expect(parseEstimateFromLabels(['enhancement'])).toBeNull();
  });
});
