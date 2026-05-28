/**
 * carrier-tracking-url helper tests (#769)
 *
 * Coverage loop over `KNOWN_CARRIER_VALUES` forces the map to stay aligned
 * with the core `KnownCarrierValues` array — adding a new known carrier in
 * core but forgetting to update the map fails this test on the next run.
 */
import { describe, it, expect } from 'vitest';
import { KNOWN_CARRIER_VALUES, type Shipment } from '../api/shipments.types';
import { buildCarrierTrackingUrl, getCarrierDisplayName } from './carrier-tracking-url';

function makeShipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: 'ol_shipment_1',
    orderId: 'ol_order_1',
    customerId: null,
    connectionId: '00000000-0000-0000-0000-000000000001',
    shippingMethod: 'paczkomat',
    status: 'dispatched',
    providerShipmentId: 'prov-1',
    paczkomatId: 'POZ08A',
    trackingNumber: '6800000001',
    carrier: 'inpost',
    labelPdfRef: null,
    dispatchedAt: '2026-05-28T10:00:00.000Z',
    deliveredAt: null,
    cancelledAt: null,
    failedAt: null,
    errorMessage: null,
    createdAt: '2026-05-28T09:00:00.000Z',
    updatedAt: '2026-05-28T10:00:00.000Z',
    ...overrides,
  };
}

describe('buildCarrierTrackingUrl', () => {
  it.each(KNOWN_CARRIER_VALUES)(
    'should resolve a tracker URL for %s (every known carrier must have a builder)',
    (carrier) => {
      const url = buildCarrierTrackingUrl(makeShipment({ carrier, trackingNumber: 'ABC123' }));
      expect(url).not.toBeNull();
      expect(url).toContain('ABC123');
      expect(url).toMatch(/^https:\/\//);
    },
  );

  it('should encodeURIComponent the tracking number to neutralise query-string injection', () => {
    const url = buildCarrierTrackingUrl(
      makeShipment({ carrier: 'inpost', trackingNumber: 'A B&C=D' }),
    );
    expect(url).not.toContain('A B&C=D');
    expect(url).toContain(encodeURIComponent('A B&C=D'));
  });

  it('should return null when carrier is null (status-sync has not backfilled yet)', () => {
    expect(buildCarrierTrackingUrl(makeShipment({ carrier: null }))).toBeNull();
  });

  it('should return null when trackingNumber is null', () => {
    expect(buildCarrierTrackingUrl(makeShipment({ trackingNumber: null }))).toBeNull();
  });

  it('should return null for an unknown carrier value (plugin-registered, FE degrades to copy-text)', () => {
    expect(
      buildCarrierTrackingUrl(makeShipment({ carrier: 'shopify-shipping', trackingNumber: 'X' })),
    ).toBeNull();
  });
});

describe('getCarrierDisplayName', () => {
  it.each(KNOWN_CARRIER_VALUES)(
    'should resolve a display name for %s (every known carrier must have a label)',
    (carrier) => {
      const name = getCarrierDisplayName(carrier);
      expect(name).not.toBeNull();
      expect(name).not.toBe(carrier); // proper-cased / branded, not the raw kebab-case
    },
  );

  it('should return null when carrier is null', () => {
    expect(getCarrierDisplayName(null)).toBeNull();
  });

  it('should fall back to the raw value for an unknown carrier (operator still sees what BE stored)', () => {
    expect(getCarrierDisplayName('shopify-shipping')).toBe('shopify-shipping');
  });
});
