/**
 * Offer Stock Restorer Capability — type guard spec
 *
 * Coverage for `isOfferStockRestorer(adapter)`: true when
 * `restoreStockOnCancellation` is a function on the `OfferManagerPort` adapter,
 * false when absent, and false when the slot exists but is not callable.
 * Mirrors `category-provisioner.capability.spec.ts`.
 *
 * @module libs/core/src/listings/domain/ports/capabilities/__tests__
 */

import type { OfferManagerPort } from '../../offer-manager.port';
import { isOfferStockRestorer } from '../offer-stock-restorer.capability';

function makeAdapter(extra: Record<string, unknown> = {}): OfferManagerPort {
  return { updateOfferQuantity: jest.fn(), ...extra } as unknown as OfferManagerPort;
}

describe('isOfferStockRestorer', () => {
  it('returns true when `restoreStockOnCancellation` is a function', () => {
    expect(isOfferStockRestorer(makeAdapter({ restoreStockOnCancellation: jest.fn() }))).toBe(true);
  });

  it('returns false when `restoreStockOnCancellation` is absent', () => {
    expect(isOfferStockRestorer(makeAdapter())).toBe(false);
  });

  it('returns false when `restoreStockOnCancellation` is present but non-function', () => {
    expect(isOfferStockRestorer(makeAdapter({ restoreStockOnCancellation: 'nope' }))).toBe(false);
  });
});
