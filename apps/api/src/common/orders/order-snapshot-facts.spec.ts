/**
 * Shared order-snapshot readers — unit specs (#3426)
 *
 * The rules that matter here are about ABSENCE, because every one of them is
 * a place a surface could print something untrue about an operator's data.
 *
 * @module apps/api/src/common/orders
 */
import type { OrderRecord } from '@openlinker/core/orders';

import { readBuyerName, readOrderReference } from './order-snapshot-facts';
import { readBuyerName as benchBuyerName, readOrderReference as benchReference } from '../../bench/application/bench-order-facts';

const order = (snapshot: Record<string, unknown>): OrderRecord =>
  ({ internalOrderId: 'ol_order_1', orderSnapshot: snapshot }) as OrderRecord;

describe('readOrderReference', () => {
  it("should return the source's own order number", () => {
    expect(readOrderReference(order({ orderNumber: 'OL-4471' }))).toBe('OL-4471');
  });

  it('should trim, and treat a blank as absent', () => {
    expect(readOrderReference(order({ orderNumber: '  OL-4471  ' }))).toBe('OL-4471');
    // A whitespace-only reference renders as a blank slot either way; reporting
    // it as present would make a caller skip its own fallback.
    expect(readOrderReference(order({ orderNumber: '   ' }))).toBeUndefined();
  });

  it('should return undefined for a non-string, a missing key and a missing order', () => {
    expect(readOrderReference(order({ orderNumber: 4471 }))).toBeUndefined();
    expect(readOrderReference(order({}))).toBeUndefined();
    expect(readOrderReference(undefined)).toBeUndefined();
  });
});

describe('readBuyerName', () => {
  it('should prefer the SHIPPING address — the name that goes on the parcel', () => {
    const name = readBuyerName(
      order({
        shippingAddress: { firstName: 'Anna', lastName: 'Kowalska' },
        billingAddress: { firstName: 'Jan', lastName: 'Nowak' },
      })
    );

    expect(name).toBe('Anna Kowalska');
  });

  it('should fall back to billing, then to a company name', () => {
    expect(readBuyerName(order({ billingAddress: { firstName: 'Jan', lastName: 'Nowak' } }))).toBe(
      'Jan Nowak'
    );
    expect(readBuyerName(order({ shippingAddress: { company: 'Blocky sp. z o.o.' } }))).toBe(
      'Blocky sp. z o.o.'
    );
  });

  it('should return the name UNMASKED — masking is the caller-surface decision', () => {
    // If this ever started masking, the bench would silently stop printing the
    // full name on a label, which is #2416's already-decided disclosure.
    expect(readBuyerName(order({ shippingAddress: { firstName: 'Anna', lastName: 'Kowalska' } })))
      .toBe('Anna Kowalska');
  });

  it('should return null when the address is redacted, absent or not an object', () => {
    // `OL_STORE_PII=false` redacts the persisted address — an ordinary answer,
    // not a failure, and never a placeholder.
    expect(readBuyerName(order({ shippingAddress: {} }))).toBeNull();
    expect(readBuyerName(order({ shippingAddress: null }))).toBeNull();
    expect(readBuyerName(order({ shippingAddress: 'Anna Kowalska' }))).toBeNull();
    expect(readBuyerName(order({}))).toBeNull();
    expect(readBuyerName(undefined)).toBeNull();
  });
});

describe('the bench re-export', () => {
  it('should be the SAME function, so the two surfaces cannot read one snapshot two ways', () => {
    // The bench module keeps its identity (it is still where a bench-specific
    // answer would be added) but delegates the mechanics. Identity, not
    // equality: a copy would pass a behavioural comparison right up until
    // somebody edited one of them.
    expect(benchReference).toBe(readOrderReference);
    expect(benchBuyerName).toBe(readBuyerName);
  });
});
