/**
 * Unit tests for the /shipments row severity + order-id truncation helpers
 * (#1826).
 */
import { describe, expect, it } from 'vitest';

import { deriveSeverityLabel, truncateOrderId } from './shipment-severity';
import { SHIPMENT_STATUS_VALUES, type Shipment } from '../api/shipments.types';

function makeShipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: 'ol_shipment_1',
    orderId: 'ol_order_1',
    customerId: null,
    connectionId: 'conn-dpd',
    shippingMethod: 'kurier',
    status: 'failed',
    providerShipmentId: null,
    paczkomatId: null,
    sourceDeliveryMethodId: null,
    deliveryIntent: null,
    trackingNumber: null,
    carrier: null,
    labelPdfRef: null,
    dispatchedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    failedAt: '2026-07-24T09:12:00.000Z',
    errorMessage: 'NOT_PROCESSED — sender postcode "22-213" invalid',
    providerCode: null,
    createdAt: '2026-07-24T09:11:00.000Z',
    updatedAt: '2026-07-24T09:12:00.000Z',
    ...overrides,
  };
}

describe('deriveSeverityLabel', () => {
  it('should collapse every status to View when canWrite is false', () => {
    for (const status of SHIPMENT_STATUS_VALUES) {
      expect(deriveSeverityLabel(makeShipment({ status }), false)).toBe('View');
    }
  });

  it('should read Fix for a failed dispatch that persisted a carrier rejection', () => {
    expect(
      deriveSeverityLabel(
        makeShipment({ status: 'failed', errorMessage: 'sender postcode invalid' }),
        true
      )
    ).toBe('Fix');
  });

  it('should read Finish for draft and cancelled - the regenerate bucket', () => {
    expect(deriveSeverityLabel(makeShipment({ status: 'draft', errorMessage: null }), true)).toBe(
      'Finish'
    );
    expect(
      deriveSeverityLabel(makeShipment({ status: 'cancelled', errorMessage: null }), true)
    ).toBe('Finish');
  });

  it('should read Send for generated - a label exists and dispatch is next', () => {
    expect(
      deriveSeverityLabel(makeShipment({ status: 'generated', errorMessage: null }), true)
    ).toBe('Send');
  });

  it('should read View for the carrier-tracked statuses with nothing to action', () => {
    for (const status of ['dispatched', 'in-transit', 'delivered'] as const) {
      expect(deriveSeverityLabel(makeShipment({ status, errorMessage: null }), true)).toBe('View');
    }
  });

  it('should read View for an omp/branch-1 row at any status - it carries no OL dispatch action', () => {
    for (const status of SHIPMENT_STATUS_VALUES) {
      expect(deriveSeverityLabel(makeShipment({ shippingMethod: 'omp', status }), true)).toBe(
        'View'
      );
    }
  });

  it('should read Finish for a failed row with no errorMessage that never minted a waybill - it just needs another dispatch attempt', () => {
    expect(
      deriveSeverityLabel(
        makeShipment({ status: 'failed', errorMessage: null, providerShipmentId: null }),
        true
      )
    ).toBe('Finish');
  });

  it('should read View for a failed row with no errorMessage that still holds a waybill - a status-sync-derived post-delivery outcome, nothing to diagnose or regenerate', () => {
    expect(
      deriveSeverityLabel(
        makeShipment({
          status: 'failed',
          errorMessage: null,
          providerShipmentId: '680000000012345',
        }),
        true
      )
    ).toBe('View');
  });

  it('should still read Fix for a failed row that holds a waybill AND a rejection message - the message is the signal', () => {
    expect(
      deriveSeverityLabel(
        makeShipment({
          status: 'failed',
          errorMessage: 'rejected by receiver',
          providerShipmentId: '680000000012345',
        }),
        true
      )
    ).toBe('Fix');
  });
});

describe('truncateOrderId', () => {
  it('should keep the ol_ prefix and elide the middle of a full internal order id', () => {
    expect(truncateOrderId('ol_order_a3f24b09c4d1486789abcdef01234567')).toBe('ol_order_a3f2…67');
  });

  it('should leave a short ol_ id untouched when its suffix is 6 characters or fewer', () => {
    expect(truncateOrderId('ol_order_123456')).toBe('ol_order_123456');
    expect(truncateOrderId('ol_order_1')).toBe('ol_order_1');
  });

  it('should truncate a 7-character ol_ suffix - the boundary just past the keep-whole limit', () => {
    expect(truncateOrderId('ol_order_1234567')).toBe('ol_order_1234…67');
  });

  it('should leave a non-OL id of 14 characters or fewer untouched', () => {
    expect(truncateOrderId('12345678901234')).toBe('12345678901234');
    expect(truncateOrderId('ORD-42')).toBe('ORD-42');
  });

  it('should elide the middle of a non-OL id longer than 14 characters', () => {
    expect(truncateOrderId('123456789012345')).toBe('12345678…2345');
  });
});
