import { describe, expect, it } from 'vitest';
import type { StockViewVariant } from '../api/inventory.types';
import { deriveAtpStatus, describeChannelRule, formatStaleness, summarizeStock } from './stock-view';

function variant(overrides: Partial<StockViewVariant>): StockViewVariant {
  return {
    productVariantId: 'v',
    sku: 'S',
    attributes: {},
    masterAvailable: 5,
    masterReserved: 0,
    availableToPromise: 4,
    provenance: 'computed',
    observedAt: '2026-09-26T08:00:00.000Z',
    stalenessMs: 0,
    olHeldNotReflected: null,
    heldCounted: 1,
    heldRecordedOnly: 0,
    livePositionCount: 1,
    isStaleSync: false,
    positions: [],
    holds: [],
    channels: [],
    ...overrides,
  };
}

describe('deriveAtpStatus', () => {
  it('should return unknown, never out of stock, when available to promise is null', () => {
    expect(deriveAtpStatus(null)).toBe('unknown');
    expect(deriveAtpStatus(undefined)).toBe('unknown');
  });
  it('should derive In / Low / Out from the value', () => {
    expect(deriveAtpStatus(0)).toBe('out-of-stock');
    expect(deriveAtpStatus(3)).toBe('low-stock');
    expect(deriveAtpStatus(19)).toBe('in-stock');
  });
});

describe('summarizeStock', () => {
  it('should sum the known figures', () => {
    const s = summarizeStock([variant({}), variant({ availableToPromise: 6, masterAvailable: 8, heldCounted: 2 })]);
    expect(s).toMatchObject({ availableToPromise: 10, masterStock: 13, heldCounted: 3 });
  });
  it('should report null rather than a partial sum when any variant is unknown', () => {
    const s = summarizeStock([variant({}), variant({ availableToPromise: null, heldCounted: null })]);
    expect(s.availableToPromise).toBeNull();
    expect(s.heldCounted).toBeNull();
  });
});

describe('formatStaleness / describeChannelRule', () => {
  it('should format minutes, hours and days', () => {
    expect(formatStaleness(12 * 60_000)).toBe('12 min ago');
    expect(formatStaleness(7 * 3_600_000)).toBe('7 h ago');
    expect(formatStaleness(72 * 3_600_000)).toBe('3 days ago');
  });
  it('should describe the buffer and the zero threshold', () => {
    expect(describeChannelRule(null)).toBe('No extra rules');
    expect(describeChannelRule({ stockSafetyBuffer: 2, stockZeroThreshold: 5 })).toBe(
      'Keeps 2 back (safety buffer). Shows 0 below 5 units',
    );
  });
});
