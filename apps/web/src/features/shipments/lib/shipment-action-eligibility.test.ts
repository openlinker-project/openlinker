/**
 * Unit tests for the shipment action-eligibility policy (#1826).
 *
 * The `canRegenerateLabel` cases below are the guard against minting (and
 * paying for) a second carrier label on a `failed` row that still holds a live
 * waybill — see the predicate's own header comment for the seven InPost
 * post-delivery outcomes that fold onto `failed`.
 */
import { describe, expect, it } from 'vitest';

import {
  CAN_CANCEL,
  CAN_DOWNLOAD_LABEL,
  CAN_GENERATE,
  CAN_NOTIFY_DISPATCHED,
  canRegenerateLabel,
  isPreWaybill,
} from './shipment-action-eligibility';
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

describe('isPreWaybill', () => {
  it('should report true when no providerShipmentId has been minted yet', () => {
    expect(isPreWaybill(makeShipment({ providerShipmentId: null }))).toBe(true);
  });

  it('should report false when the shipment already holds a carrier waybill', () => {
    expect(isPreWaybill(makeShipment({ providerShipmentId: '680000000012345' }))).toBe(false);
  });
});

describe('CAN_GENERATE', () => {
  it('should contain only the pre-dispatch and recoverable statuses', () => {
    // `'none'` is the shipment-less first-label case; it is a set member only
    // (`canRegenerateLabel` is never called with it - its caller short-circuits
    // on `shipment === null`), which is why it has no predicate case below.
    expect([...CAN_GENERATE].sort()).toEqual(['cancelled', 'draft', 'failed', 'none']);
  });

  it('should no longer contain delivered (#1905 review) - an arrived parcel has nothing left to dispatch', () => {
    expect(CAN_GENERATE.has('delivered')).toBe(false);
  });
});

describe('canRegenerateLabel', () => {
  it('should refuse every status when canWrite is false', () => {
    for (const status of SHIPMENT_STATUS_VALUES) {
      // Both waybill states, so the permission gate is proven to short-circuit
      // ahead of the pre-waybill check rather than coinciding with it.
      expect(canRegenerateLabel(makeShipment({ status, providerShipmentId: null }), false)).toBe(
        false
      );
      expect(
        canRegenerateLabel(makeShipment({ status, providerShipmentId: '680000000012345' }), false)
      ).toBe(false);
    }
  });

  it('should refuse a failed shipment that still holds a providerShipmentId - regenerating would buy a second label while the first stays live', () => {
    expect(
      canRegenerateLabel(
        makeShipment({ status: 'failed', providerShipmentId: '680000000012345' }),
        true
      )
    ).toBe(false);
  });

  it('should allow a failed shipment with no providerShipmentId - the dispatch was rejected before any label was minted', () => {
    expect(
      canRegenerateLabel(makeShipment({ status: 'failed', providerShipmentId: null }), true)
    ).toBe(true);
  });

  it('should allow draft regardless of waybill state - a draft never reached the carrier', () => {
    expect(
      canRegenerateLabel(makeShipment({ status: 'draft', providerShipmentId: null }), true)
    ).toBe(true);
  });

  it('should allow cancelled even with a providerShipmentId - that waybill was explicitly voided with the carrier', () => {
    expect(
      canRegenerateLabel(
        makeShipment({ status: 'cancelled', providerShipmentId: '680000000012345' }),
        true
      )
    ).toBe(true);
  });

  it('should refuse statuses outside CAN_GENERATE even for a writer', () => {
    for (const status of ['generated', 'dispatched', 'in-transit', 'delivered'] as const) {
      expect(canRegenerateLabel(makeShipment({ status }), true)).toBe(false);
    }
  });
});

describe('the remaining eligibility sets', () => {
  it('should gate cancel and manual dispatch to generated only', () => {
    expect([...CAN_CANCEL]).toEqual(['generated']);
    expect([...CAN_NOTIFY_DISPATCHED]).toEqual(['generated']);
  });

  it('should keep the label document retrievable across the carrier-tracked lifecycle', () => {
    expect([...CAN_DOWNLOAD_LABEL].sort()).toEqual([
      'delivered',
      'dispatched',
      'generated',
      'in-transit',
    ]);
    for (const status of ['draft', 'failed', 'cancelled'] as const) {
      expect(CAN_DOWNLOAD_LABEL.has(status)).toBe(false);
    }
  });
});
