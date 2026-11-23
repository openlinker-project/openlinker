import { describe, expect, it } from 'vitest';
import { unsettledBundleVariants } from './bundle-kind';

describe('unsettledBundleVariants', () => {
  const rows = [
    { variants: [{ variantId: 'a', included: true }] },
    { variants: [{ variantId: 'b', included: true }, { variantId: 'c', included: false }] },
  ];

  it('should hold every included variant that has no answer while the check runs', () => {
    const result = unsettledBundleVariants(rows, new Set(['a']), new Set(), true);
    expect([...result.pending]).toEqual(['b']);
    expect(result.failed.size).toBe(0);
  });

  it('should report failed variants only once the check has finished', () => {
    const result = unsettledBundleVariants(rows, new Set(), new Set(['b']), false);
    expect([...result.failed]).toEqual(['b']);
    expect(result.pending.size).toBe(0);
  });
});
