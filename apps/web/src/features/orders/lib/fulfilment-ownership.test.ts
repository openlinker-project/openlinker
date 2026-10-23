/**
 * isFulfilmentOwnedByDestination tests (#2118)
 *
 * @module features/orders/lib
 */
import { describe, expect, it } from 'vitest';
import { isFulfilmentOwnedByDestination } from './fulfilment-ownership';

const owned = new Set(['conn-wms']);

describe('isFulfilmentOwnedByDestination', () => {
  it('should be false when no connection is flagged', () => {
    expect(
      isFulfilmentOwnedByDestination([{ destinationConnectionId: 'conn-wms' }], new Set())
    ).toBe(false);
  });

  it('should be true when a destination of the order is flagged', () => {
    expect(
      isFulfilmentOwnedByDestination(
        [{ destinationConnectionId: 'conn-shop' }, { destinationConnectionId: 'conn-wms' }],
        owned
      )
    ).toBe(true);
  });

  it('should be false when the order went only to unflagged destinations', () => {
    expect(isFulfilmentOwnedByDestination([{ destinationConnectionId: 'conn-shop' }], owned)).toBe(
      false
    );
  });

  it('should be false for an order with no destinations or an absent list', () => {
    expect(isFulfilmentOwnedByDestination([], owned)).toBe(false);
    expect(isFulfilmentOwnedByDestination(undefined, owned)).toBe(false);
    expect(isFulfilmentOwnedByDestination(null, owned)).toBe(false);
  });
});
