/**
 * Offer Quantity Write-Order Rule Tests
 *
 * @module libs/core/src/inventory/domain/types/__tests__
 */

import {
  isWritableQuantityObservation,
  offerQuantityObservationCursorKey,
  offerQuantityWriteLockKey,
} from '../offer-quantity-write-order.types';

describe('isWritableQuantityObservation', () => {
  const older = '2026-08-27T10:00:00.000Z';
  const newer = '2026-08-27T10:00:05.000Z';

  it('should allow the write when no observation was ever written', () => {
    expect(isWritableQuantityObservation(older, null)).toBe(true);
  });

  it('should allow the write when the observation is newer', () => {
    expect(isWritableQuantityObservation(newer, older)).toBe(true);
  });

  it('should refuse the write when the observation is older', () => {
    expect(isWritableQuantityObservation(older, newer)).toBe(false);
  });

  it('should allow the write when the observation is equal, so a retry still lands', () => {
    expect(isWritableQuantityObservation(newer, newer)).toBe(true);
  });

  it('should allow the write when either side is unparseable', () => {
    expect(isWritableQuantityObservation('legacy', newer)).toBe(true);
    expect(isWritableQuantityObservation(older, 'legacy')).toBe(true);
  });
});

describe('key builders', () => {
  it('should key the lock per connection and offer', () => {
    expect(offerQuantityWriteLockKey('c1', 'o1')).not.toEqual(
      offerQuantityWriteLockKey('c2', 'o1')
    );
  });

  it('should key the mark per offer', () => {
    expect(offerQuantityObservationCursorKey('o1')).not.toEqual(
      offerQuantityObservationCursorKey('o2')
    );
  });
});
