/**
 * Unit tests for the cause-first triage grouping helper (#1826).
 */
import { describe, expect, it } from 'vitest';

import { REDACTED_ERROR_MESSAGE, type Shipment } from '../api/shipments.types';
import { groupFailedShipmentsByCause, normaliseErrorMessage } from './group-failed-shipments-by-cause';

function makeShipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: 'ol_shipment_1',
    orderId: 'ol_order_1',
    customerId: null,
    connectionId: '00000000-0000-0000-0000-000000000001',
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
    errorMessage: 'NOT_PROCESSED — sender postcode "22-213" is not a valid delivery code',
    createdAt: '2026-07-24T09:11:00.000Z',
    updatedAt: '2026-07-24T09:12:00.000Z',
    ...overrides,
  };
}

describe('normaliseErrorMessage', () => {
  it('lowercases, strips digit runs, and collapses punctuation residue', () => {
    expect(normaliseErrorMessage('  NOT_PROCESSED — sender postcode "22-213" invalid  ')).toBe(
      'not processed sender postcode invalid',
    );
  });

  it('collapses two messages differing only by an embedded numeric reference to the same key', () => {
    const a = normaliseErrorMessage('Rejected for order 100234: sender postcode invalid');
    const b = normaliseErrorMessage('Rejected for order 100987: sender postcode invalid');
    expect(a).toBe(b);
  });

  it('collapses a quoted digit run and its punctuation to the same key as an unquoted one (#1826 fix)', () => {
    // Before the fix, trimming ran BEFORE digit-stripping, so a quoted/
    // punctuated digit run left residue (`"-"` vs `""`) that kept these two
    // messages in separate groups despite sharing the same root cause.
    const a = normaliseErrorMessage('Sender postcode "22-213" invalid');
    const b = normaliseErrorMessage('Sender postcode "22213" invalid');
    expect(a).toBe(b);
    expect(a).toBe('sender postcode invalid');
  });

  it('collapses a message with a trailing digit run to the same key as one with none at all (#1826 fix)', () => {
    const withDigits = normaliseErrorMessage('DPD rejected: sender postcode invalid 22213');
    const withoutDigits = normaliseErrorMessage('DPD rejected: sender postcode invalid');
    expect(withDigits).toBe(withoutDigits);
  });
});

describe('groupFailedShipmentsByCause', () => {
  it('groups two failed rows sharing a normalised cause', () => {
    const shipments = [
      makeShipment({ id: 'ol_shipment_1', errorMessage: 'sender postcode "22-213" invalid' }),
      makeShipment({ id: 'ol_shipment_2', errorMessage: 'sender postcode "22-213" invalid' }),
    ];
    const groups = groupFailedShipmentsByCause(shipments);
    expect(groups).toHaveLength(1);
    expect(groups[0].shipments.map((s) => s.id)).toEqual(['ol_shipment_1', 'ol_shipment_2']);
  });

  it('produces no group for a single failed shipment', () => {
    const shipments = [makeShipment({ id: 'ol_shipment_1' })];
    expect(groupFailedShipmentsByCause(shipments)).toEqual([]);
  });

  it('excludes non-failed rows even with a matching errorMessage-shaped field', () => {
    const shipments = [
      makeShipment({ id: 'ol_shipment_1', status: 'failed' }),
      makeShipment({ id: 'ol_shipment_2', status: 'delivered' }),
    ];
    expect(groupFailedShipmentsByCause(shipments)).toEqual([]);
  });

  it('excludes a failed row with no persisted errorMessage', () => {
    const shipments = [
      makeShipment({ id: 'ol_shipment_1', errorMessage: null }),
      makeShipment({ id: 'ol_shipment_2', errorMessage: null }),
    ];
    expect(groupFailedShipmentsByCause(shipments)).toEqual([]);
  });

  it('collapses case/whitespace variants of the same cause', () => {
    const shipments = [
      makeShipment({ id: 'ol_shipment_1', errorMessage: 'Sender Postcode Invalid' }),
      makeShipment({ id: 'ol_shipment_2', errorMessage: '  sender   postcode invalid  ' }),
    ];
    const groups = groupFailedShipmentsByCause(shipments);
    expect(groups).toHaveLength(1);
    expect(groups[0].shipments).toHaveLength(2);
  });

  it('keeps distinct causes in separate groups', () => {
    const shipments = [
      makeShipment({ id: 'ol_shipment_1', errorMessage: 'sender postcode invalid' }),
      makeShipment({ id: 'ol_shipment_2', errorMessage: 'sender postcode invalid' }),
      makeShipment({ id: 'ol_shipment_3', errorMessage: 'recipient address unreachable' }),
      makeShipment({ id: 'ol_shipment_4', errorMessage: 'recipient address unreachable' }),
    ];
    const groups = groupFailedShipmentsByCause(shipments);
    expect(groups).toHaveLength(2);
  });

  it('groups a third shipment sharing the same cause into the existing group, not a new one', () => {
    const shipments = [
      makeShipment({ id: 'ol_shipment_1', errorMessage: 'sender postcode invalid' }),
      makeShipment({ id: 'ol_shipment_2', errorMessage: 'sender postcode invalid' }),
      makeShipment({ id: 'ol_shipment_3', errorMessage: 'sender postcode invalid' }),
    ];
    const groups = groupFailedShipmentsByCause(shipments);
    expect(groups).toHaveLength(1);
    expect(groups[0].shipments.map((s) => s.id)).toEqual([
      'ol_shipment_1',
      'ol_shipment_2',
      'ol_shipment_3',
    ]);
  });

  it('keeps the same cause on two DIFFERENT connections in separate groups (#1826 fix) — a shared cause across connections is a coincidence, not one fixable root cause', () => {
    const shipments = [
      makeShipment({
        id: 'ol_shipment_1',
        connectionId: 'conn-dpd-warehouse-a',
        errorMessage: 'sender postcode invalid',
      }),
      makeShipment({
        id: 'ol_shipment_2',
        connectionId: 'conn-dpd-warehouse-a',
        errorMessage: 'sender postcode invalid',
      }),
      makeShipment({
        id: 'ol_shipment_3',
        connectionId: 'conn-dpd-warehouse-b',
        errorMessage: 'sender postcode invalid',
      }),
      makeShipment({
        id: 'ol_shipment_4',
        connectionId: 'conn-dpd-warehouse-b',
        errorMessage: 'sender postcode invalid',
      }),
    ];
    const groups = groupFailedShipmentsByCause(shipments);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.connectionId).sort()).toEqual([
      'conn-dpd-warehouse-a',
      'conn-dpd-warehouse-b',
    ]);
    for (const group of groups) {
      expect(group.shipments.every((s) => s.connectionId === group.connectionId)).toBe(true);
    }
  });

  it('should not group two numeric-only messages on the same connection (#1905 fix) - both normalise to an empty key, which asserts nothing', () => {
    const shipments = [
      makeShipment({ id: 'ol_shipment_1', errorMessage: '500' }),
      makeShipment({ id: 'ol_shipment_2', errorMessage: '404' }),
    ];
    expect(groupFailedShipmentsByCause(shipments)).toEqual([]);
  });

  it('should not group two identical numeric-only messages either - a degenerate key stays degenerate', () => {
    const shipments = [
      makeShipment({ id: 'ol_shipment_1', errorMessage: '500' }),
      makeShipment({ id: 'ol_shipment_2', errorMessage: '500' }),
    ];
    expect(groupFailedShipmentsByCause(shipments)).toEqual([]);
  });

  it('should not group two different non-Latin-script messages (#1905 fix) - normalisation strips every non-[a-z] character, so both collapse to an empty key', () => {
    const shipments = [
      makeShipment({ id: 'ol_shipment_1', errorMessage: 'Неверный индекс отправителя' }),
      makeShipment({ id: 'ol_shipment_2', errorMessage: 'Получатель отказался' }),
    ];
    expect(groupFailedShipmentsByCause(shipments)).toEqual([]);
  });

  it('should not group a normalised key shorter than three letters - two letters cannot carry a diagnosable cause', () => {
    const shipments = [
      makeShipment({ id: 'ol_shipment_1', errorMessage: 'E1 42' }),
      makeShipment({ id: 'ol_shipment_2', errorMessage: 'E1 77' }),
    ];
    expect(groupFailedShipmentsByCause(shipments)).toEqual([]);
  });

  it('should not group rows carrying the role-redaction placeholder (#1905 fix) - a viewer sees the same string on every failure, which is not a shared cause', () => {
    const shipments = [
      makeShipment({ id: 'ol_shipment_1', errorMessage: REDACTED_ERROR_MESSAGE }),
      makeShipment({ id: 'ol_shipment_2', errorMessage: REDACTED_ERROR_MESSAGE }),
      makeShipment({ id: 'ol_shipment_3', errorMessage: REDACTED_ERROR_MESSAGE }),
    ];
    expect(groupFailedShipmentsByCause(shipments)).toEqual([]);
  });

  it('does NOT form a group across two connections that would total 2+ only when combined', () => {
    // One shipment per connection sharing a cause — neither connection alone
    // has a repeatable pattern, so no strip should fire for either.
    const shipments = [
      makeShipment({
        id: 'ol_shipment_1',
        connectionId: 'conn-a',
        errorMessage: 'sender postcode invalid',
      }),
      makeShipment({
        id: 'ol_shipment_2',
        connectionId: 'conn-b',
        errorMessage: 'sender postcode invalid',
      }),
    ];
    expect(groupFailedShipmentsByCause(shipments)).toEqual([]);
  });
});
