/**
 * readFulfilmentOwnedByDestination tests (#2118)
 *
 * Mirrors the core spec: only the boolean `true` reads as set.
 *
 * @module features/connections/lib
 */
import { describe, expect, it } from 'vitest';
import { readFulfilmentOwnedByDestination } from './fulfilment-ownership';

describe('readFulfilmentOwnedByDestination', () => {
  it('should default to false for a missing config or key', () => {
    expect(readFulfilmentOwnedByDestination(null)).toBe(false);
    expect(readFulfilmentOwnedByDestination(undefined)).toBe(false);
    expect(readFulfilmentOwnedByDestination({})).toBe(false);
  });

  it('should read an explicit boolean', () => {
    expect(readFulfilmentOwnedByDestination({ fulfilmentOwnedByDestination: true })).toBe(true);
    expect(readFulfilmentOwnedByDestination({ fulfilmentOwnedByDestination: false })).toBe(false);
  });

  it('should read any non-boolean value as false', () => {
    for (const raw of ['true', 1, null, {}]) {
      expect(readFulfilmentOwnedByDestination({ fulfilmentOwnedByDestination: raw })).toBe(false);
    }
  });
});
