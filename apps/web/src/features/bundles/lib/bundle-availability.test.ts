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

  // The same table drives the backend preview rule (floor(available / quantity), minimum over
  // components, a reserve subtracted from the stock first). A reserve is an input here, not logic.
  it.each([
    { label: 'stock 7, quantity 2', stock: [7], qty: [2], reserve: 0, bundles: 3 },
    { label: 'a zero-stock component', stock: [10, 0], qty: [1, 1], reserve: 0, bundles: 0 },
    { label: 'a reserve of 2 on stock 7', stock: [7], qty: [1], reserve: 2, bundles: 5 },
    { label: 'a reserve larger than stock', stock: [1], qty: [1], reserve: 4, bundles: 0 },
  ])('should give $bundles bundles for $label', ({ stock, qty, reserve, bundles }) => {
    const result = computeBundleAvailability(
      stock.map((s, i) => ({
        name: `C${String(i)}`,
        quantity: qty[i] ?? 1,
        availableToPromise: Math.max(0, s - reserve),
      })),
    );
    expect(result).toMatchObject({ kind: 'known', bundles });
  });
});
