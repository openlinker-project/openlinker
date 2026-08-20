/**
 * Unit tests for the /shipments row severity + order-id truncation helpers
 * (#1826).
 */
import { describe, expect, it } from 'vitest';

import { deriveSeverityLabel } from './shipment-severity';
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
    orderSummary: null,
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
