/**
 * Unit tests for the cause-first triage grouping helper (#1826).
 */
import { describe, expect, it } from 'vitest';

import { REDACTED_ERROR_MESSAGE, type Shipment } from '../api/shipments.types';
import {
  groupFailedShipmentsByCause,
  isExactProviderCode,
  normaliseErrorMessage,
} from './group-failed-shipments-by-cause';

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
    providerCode: null,
    createdAt: '2026-07-24T09:11:00.000Z',
    updatedAt: '2026-07-24T09:12:00.000Z',
    orderSummary: null,
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

  it('groups by providerCode when present, ignoring differing errorMessage text (#1918)', () => {
    const shipments = [
      makeShipment({
        id: 'ol_shipment_1',
        errorMessage: 'Validation error',
        providerCode: 'preflight.missing-parcel-template',
      }),
      makeShipment({
        id: 'ol_shipment_2',
        errorMessage: 'Validation error (different wording entirely)',
        providerCode: 'preflight.missing-parcel-template',
      }),
    ];
    const groups = groupFailedShipmentsByCause(shipments);
    expect(groups).toHaveLength(1);
    expect(groups[0].providerCode).toBe('preflight.missing-parcel-template');
    expect(groups[0].shipments.map((s) => s.id)).toEqual(['ol_shipment_1', 'ol_shipment_2']);
  });

  it('keeps two DIFFERENT providerCodes apart even when errorMessage text is identical (#1918)', () => {
    const shipments = [
      makeShipment({
        id: 'ol_shipment_1',
        errorMessage: 'Validation error',
        providerCode: 'preflight.missing-parcel-template',
      }),
      makeShipment({
        id: 'ol_shipment_2',
        errorMessage: 'Validation error',
        providerCode: 'api.http-503',
      }),
    ];
    expect(groupFailedShipmentsByCause(shipments)).toEqual([]);
  });

  it('falls back to normalised-text grouping when providerCode is null', () => {
    const shipments = [
      makeShipment({ id: 'ol_shipment_1', errorMessage: 'sender postcode invalid', providerCode: null }),
      makeShipment({ id: 'ol_shipment_2', errorMessage: 'sender postcode invalid', providerCode: null }),
    ];
    const groups = groupFailedShipmentsByCause(shipments);
    expect(groups).toHaveLength(1);
    expect(groups[0].providerCode).toBeNull();
  });

  it('does not mix a providerCode-keyed row with a text-fallback row even if the text would otherwise match', () => {
    const shipments = [
      makeShipment({
        id: 'ol_shipment_1',
        errorMessage: 'sender postcode invalid',
        providerCode: 'preflight.missing-parcel-template',
      }),
      makeShipment({ id: 'ol_shipment_2', errorMessage: 'sender postcode invalid', providerCode: null }),
    ];
    expect(groupFailedShipmentsByCause(shipments)).toEqual([]);
  });

  it('does NOT group two rows sharing only a COARSE shipx.* code when their messages differ (#2873)', () => {
    // #2805 gives every no-details ShipX rejection the same bucket code, so
    // trusting it alone would collapse a bad postcode and an over-limit COD
    // into one "shared rejection code" group.
    const shipments = [
      makeShipment({
        id: 'ol_shipment_1',
        errorMessage: 'sender postcode invalid',
        providerCode: 'shipx.validation_failed',
      }),
      makeShipment({
        id: 'ol_shipment_2',
        errorMessage: 'declared value exceeds the insured limit',
        providerCode: 'shipx.validation_failed',
      }),
    ];
    expect(groupFailedShipmentsByCause(shipments)).toEqual([]);
  });

  it('groups two rows sharing a coarse code AND a message, and still carries the code for display (#2873)', () => {
    const shipments = [
      makeShipment({
        id: 'ol_shipment_1',
        errorMessage: 'sender postcode "22-213" invalid',
        providerCode: 'shipx.validation_failed',
      }),
      makeShipment({
        id: 'ol_shipment_2',
        errorMessage: 'sender postcode "22999" invalid',
        providerCode: 'shipx.validation_failed',
      }),
    ];
    const groups = groupFailedShipmentsByCause(shipments);
    expect(groups).toHaveLength(1);
    expect(groups[0].providerCode).toBe('shipx.validation_failed');
    expect(groups[0].shipments.map((s) => s.id)).toEqual(['ol_shipment_1', 'ol_shipment_2']);
  });

  it('keeps two DIFFERENT coarse codes apart even when the message is identical (#2873)', () => {
    const shipments = [
      makeShipment({
        id: 'ol_shipment_1',
        errorMessage: 'sender postcode invalid',
        providerCode: 'shipx.validation_failed',
      }),
      makeShipment({
        id: 'ol_shipment_2',
        errorMessage: 'sender postcode invalid',
        providerCode: 'shipx.not_found',
      }),
    ];
    expect(groupFailedShipmentsByCause(shipments)).toEqual([]);
  });

  it('applies the minimum-cause-key guard to a coarse code whose message normalises away (#2873)', () => {
    // '500' / '404' both normalise to '', so the composite key would be the
    // bare code and the group would assert a shared cause between two
    // failures that have nothing in common but a carrier bucket.
    const shipments = [
      makeShipment({
        id: 'ol_shipment_1',
        errorMessage: '500',
        providerCode: 'shipx.validation_failed',
      }),
      makeShipment({
        id: 'ol_shipment_2',
        errorMessage: '404',
        providerCode: 'shipx.validation_failed',
      }),
    ];
    expect(groupFailedShipmentsByCause(shipments)).toEqual([]);
  });

  it('still groups an EXACT providerCode across differing messages after the #2873 narrowing', () => {
    const shipments = [
      makeShipment({
        id: 'ol_shipment_1',
        errorMessage: 'Service temporarily unavailable',
        providerCode: 'api.http-503',
      }),
      makeShipment({
        id: 'ol_shipment_2',
        errorMessage: 'Upstream is down, try later',
        providerCode: 'api.http-503',
      }),
    ];
    const groups = groupFailedShipmentsByCause(shipments);
    expect(groups).toHaveLength(1);
    expect(groups[0].providerCode).toBe('api.http-503');
  });

  it('does not mix a coarse-code row with a no-code row even when the message matches (#2873)', () => {
    const shipments = [
      makeShipment({
        id: 'ol_shipment_1',
        errorMessage: 'sender postcode invalid',
        providerCode: 'shipx.validation_failed',
      }),
      makeShipment({ id: 'ol_shipment_2', errorMessage: 'sender postcode invalid', providerCode: null }),
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

describe('isExactProviderCode', () => {
  it.each(['api.http-503', 'api.http-401', 'preflight.missing-parcel-template', 'command.rejected', 'target_point'])(
    'treats %s as exact, because its family narrows the cause',
    (code) => {
      expect(isExactProviderCode(code)).toBe(true);
    },
  );

  it.each(['shipx.validation_failed', 'shipx.not_found', 'PARCEL_TOO_LARGE'])(
    'treats %s as coarse, because it names a bucket rather than a cause',
    (code) => {
      expect(isExactProviderCode(code)).toBe(false);
    },
  );

  it('treats a missing code as coarse — it carries no structure at all', () => {
    expect(isExactProviderCode(null)).toBe(false);
  });
});
