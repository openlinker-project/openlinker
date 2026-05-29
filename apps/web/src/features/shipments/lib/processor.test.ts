/**
 * Unit tests for the processor derivation helpers (#839).
 */
import { describe, expect, it } from 'vitest';

import type { Shipment } from '../api/shipments.types';
import {
  deriveProcessor,
  parseProcessorFilter,
  toShipmentProcessorFilters,
} from './processor';

function makeShipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: 'ol_shipment_1',
    orderId: 'ol_order_1',
    customerId: null,
    connectionId: '00000000-0000-0000-0000-000000000001',
    shippingMethod: 'paczkomat',
    status: 'generated',
    providerShipmentId: 'PROV-1',
    paczkomatId: null,
    trackingNumber: null,
    carrier: null,
    labelPdfRef: null,
    dispatchedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    failedAt: null,
    errorMessage: null,
    createdAt: '2026-05-29T10:00:00.000Z',
    updatedAt: '2026-05-29T10:00:00.000Z',
    ...overrides,
  };
}

describe('deriveProcessor', () => {
  it("should return 'omp' for branch-1 (shippingMethod === 'omp')", () => {
    expect(
      deriveProcessor(makeShipment({ shippingMethod: 'omp', providerShipmentId: null })),
    ).toBe('omp');
  });

  it("should return 'carrier' for branches 2/3 (providerShipmentId present)", () => {
    expect(
      deriveProcessor(
        makeShipment({ shippingMethod: 'paczkomat', providerShipmentId: 'PROV-9' }),
      ),
    ).toBe('carrier');
  });

  it("should return 'pending' for draft rows (no provider id, non-omp method)", () => {
    expect(
      deriveProcessor(
        makeShipment({ shippingMethod: 'kurier', providerShipmentId: null, status: 'draft' }),
      ),
    ).toBe('pending');
  });

  it("should prefer 'omp' over 'carrier' when both signals are present", () => {
    // Defensive: branch-1 rows should never carry a providerShipmentId by
    // construction, but if the BE ever surfaces one, the FE still treats
    // the row as OMP-fulfilled (matches the BE invariant in #882's
    // partial-unique index).
    expect(
      deriveProcessor(makeShipment({ shippingMethod: 'omp', providerShipmentId: 'PROV-7' })),
    ).toBe('omp');
  });
});

describe('parseProcessorFilter', () => {
  it("should accept 'omp' and 'carrier'", () => {
    expect(parseProcessorFilter('omp')).toBe('omp');
    expect(parseProcessorFilter('carrier')).toBe('carrier');
  });

  it('should return undefined for null', () => {
    expect(parseProcessorFilter(null)).toBeUndefined();
  });

  it('should return undefined for unknown values (defensive narrowing)', () => {
    expect(parseProcessorFilter('pending')).toBeUndefined();
    expect(parseProcessorFilter('garbage')).toBeUndefined();
    expect(parseProcessorFilter('')).toBeUndefined();
  });
});

describe('toShipmentProcessorFilters', () => {
  it("should map 'omp' to { shippingMethod: 'omp' }", () => {
    expect(toShipmentProcessorFilters('omp')).toEqual({ shippingMethod: 'omp' });
  });

  it("should map 'carrier' to { hasProviderShipmentId: true }", () => {
    expect(toShipmentProcessorFilters('carrier')).toEqual({ hasProviderShipmentId: true });
  });

  it('should return an empty slice when processor is undefined', () => {
    expect(toShipmentProcessorFilters(undefined)).toEqual({});
  });
});
