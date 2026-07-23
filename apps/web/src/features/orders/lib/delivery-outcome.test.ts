import { describe, expect, it } from 'vitest';

import { deriveDeliveryOutcome } from './delivery-outcome';

describe('deriveDeliveryOutcome', () => {
  it('should be "resolved" for a carrier-driven order with a booked label', () => {
    expect(
      deriveDeliveryOutcome({
        processorKind: 'ol_managed_carrier',
        hasMethod: true,
        isFulfilled: true,
      }),
    ).toBe('resolved');
  });

  it('should be "awaiting-label" for a carrier-driven order without a label yet', () => {
    expect(
      deriveDeliveryOutcome({
        processorKind: 'source_brokered',
        hasMethod: true,
        isFulfilled: false,
      }),
    ).toBe('awaiting-label');
  });

  it('should stay carrier-driven (never no-method) even when hasMethod is false', () => {
    expect(
      deriveDeliveryOutcome({
        processorKind: 'ol_managed_carrier',
        hasMethod: false,
        isFulfilled: false,
      }),
    ).toBe('awaiting-label');
  });

  it('should be "shop-fulfilled" for the omp_fulfilled default with a method', () => {
    expect(
      deriveDeliveryOutcome({ processorKind: 'omp_fulfilled', hasMethod: true, isFulfilled: false }),
    ).toBe('shop-fulfilled');
  });

  it('should be "no-method" for the omp_fulfilled default with no method', () => {
    expect(
      deriveDeliveryOutcome({
        processorKind: 'omp_fulfilled',
        hasMethod: false,
        isFulfilled: false,
      }),
    ).toBe('no-method');
  });

  it('should treat an absent processorKind (older payload) as the shop default', () => {
    expect(deriveDeliveryOutcome({ hasMethod: true, isFulfilled: false })).toBe('shop-fulfilled');
    expect(deriveDeliveryOutcome({ hasMethod: false, isFulfilled: false })).toBe('no-method');
  });

  it('should NOT read as carrier-driven when the routed processor is disabled (#1799)', () => {
    // A carrier rule to a disabled connection is not a live route — it falls
    // through to the shop-default branch (pairs with the `disabled` rider),
    // never promising a label.
    expect(
      deriveDeliveryOutcome({
        processorKind: 'ol_managed_carrier',
        hasMethod: true,
        isFulfilled: false,
        processorAvailable: false,
      }),
    ).toBe('shop-fulfilled');
    expect(
      deriveDeliveryOutcome({
        processorKind: 'ol_managed_carrier',
        hasMethod: false,
        isFulfilled: false,
        processorAvailable: false,
      }),
    ).toBe('no-method');
  });

  it('should stay carrier-driven when the processor is available (explicit true)', () => {
    expect(
      deriveDeliveryOutcome({
        processorKind: 'ol_managed_carrier',
        hasMethod: true,
        isFulfilled: true,
        processorAvailable: true,
      }),
    ).toBe('resolved');
  });
});
