import { describe, expect, it } from 'vitest';
import { computeBundleAvailability } from './bundle-availability';

describe('computeBundleAvailability', () => {
  it('should name the component that allows the fewest bundles', () => {
    expect(
      computeBundleAvailability([
        { name: 'Mug', quantity: 1, availableToPromise: 78 },
        { name: 'Spoon', quantity: 1, availableToPromise: 1 },
      ]),
    ).toEqual({ kind: 'known', bundles: 1, limitedBy: 'Spoon' });
  });

  it('should divide by the quantity of each component', () => {
    expect(
      computeBundleAvailability([{ name: 'Coffee', quantity: 3, availableToPromise: 10 }]),
    ).toEqual({ kind: 'known', bundles: 3, limitedBy: null });
  });

  it('should read an unknown component as unknown, never as zero', () => {
    expect(
      computeBundleAvailability([
        { name: 'Mug', quantity: 1, availableToPromise: 5 },
        { name: 'Press', quantity: 1, availableToPromise: null },
      ]),
    ).toEqual({ kind: 'unknown', component: 'Press' });
  });

  it('should report an empty composition', () => {
    expect(computeBundleAvailability([])).toEqual({ kind: 'empty' });
  });
});
