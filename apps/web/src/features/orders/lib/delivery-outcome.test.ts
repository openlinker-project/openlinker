import { describe, expect, it } from 'vitest';

import { deriveDeliveryOutcome, hasLiveOlCarrierRoute } from './delivery-outcome';
import type { OrderDeliveryResolution } from '../api/orders.types';

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

describe('hasLiveOlCarrierRoute (#1799)', () => {
  const res = (o: Partial<OrderDeliveryResolution>): OrderDeliveryResolution => ({
    source: 'rule',
    processorKind: 'ol_managed_carrier',
    processorConnectionId: 'conn-x',
    processorAvailable: true,
    ...o,
  });

  it('is true for an available ol_managed_carrier / source_brokered route', () => {
    expect(hasLiveOlCarrierRoute(res({ processorKind: 'ol_managed_carrier' }))).toBe(true);
    expect(
      hasLiveOlCarrierRoute(res({ processorKind: 'source_brokered', processorConnectionId: 'conn-x' })),
    ).toBe(true);
  });

  it('is false for a disabled processor (processorAvailable false)', () => {
    expect(hasLiveOlCarrierRoute(res({ processorAvailable: false }))).toBe(false);
  });

  it('is false for the omp_fulfilled default (shop-fulfilled)', () => {
    expect(
      hasLiveOlCarrierRoute(res({ source: 'default', processorKind: 'omp_fulfilled', processorConnectionId: null })),
    ).toBe(false);
  });

  it('is false when there is no resolution (no method / older payload)', () => {
    expect(hasLiveOlCarrierRoute(undefined)).toBe(false);
    expect(hasLiveOlCarrierRoute(null)).toBe(false);
  });

  it('treats an absent processorAvailable (older payload) as available', () => {
    const legacy = { source: 'rule', processorKind: 'ol_managed_carrier', processorConnectionId: 'c' } as OrderDeliveryResolution;
    expect(hasLiveOlCarrierRoute(legacy)).toBe(true);
  });
});
