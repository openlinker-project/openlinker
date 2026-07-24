import { describe, expect, it } from 'vitest';
import { bucketCount } from './bucket-count';

describe('bucketCount', () => {
  it.each([
    [0, '0'],
    [1, '1-10'],
    [10, '1-10'],
    [11, '11-50'],
    [50, '11-50'],
    [51, '50+'],
    [1000, '50+'],
  ])('buckets %i as %s', (count, expected) => {
    expect(bucketCount(count)).toBe(expected);
  });
});
