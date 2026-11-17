/**
 * readNotifyOnLabelPurchase tests (#4097)
 *
 * Mirrors the core reader: only a literal `true` inside an object namespace reads as on.
 *
 * @module features/connections/lib
 */
import { describe, expect, it } from 'vitest';
import { readNotifyOnLabelPurchase } from './label-purchase-notification';

describe('readNotifyOnLabelPurchase', () => {
  it('should default to false for a missing config, namespace or key', () => {
    expect(readNotifyOnLabelPurchase(null)).toBe(false);
    expect(readNotifyOnLabelPurchase(undefined)).toBe(false);
    expect(readNotifyOnLabelPurchase({})).toBe(false);
    expect(readNotifyOnLabelPurchase({ shipping: {} })).toBe(false);
  });

  it('should read an explicit boolean', () => {
    expect(readNotifyOnLabelPurchase({ shipping: { notifyMarketplaceOnLabelPurchase: true } })).toBe(true);
    expect(readNotifyOnLabelPurchase({ shipping: { notifyMarketplaceOnLabelPurchase: false } })).toBe(false);
  });

  it('should read any non-boolean value or malformed namespace as false', () => {
    for (const raw of ['true', 1, null, {}]) {
      expect(readNotifyOnLabelPurchase({ shipping: { notifyMarketplaceOnLabelPurchase: raw } })).toBe(false);
    }
    for (const namespace of [true, 'yes', null, [true]]) {
      expect(readNotifyOnLabelPurchase({ shipping: namespace })).toBe(false);
    }
  });
});
