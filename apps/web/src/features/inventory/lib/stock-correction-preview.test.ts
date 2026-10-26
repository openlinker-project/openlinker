import { describe, expect, it } from 'vitest';
import type { StockViewChannel, StockViewVariant } from '../api/inventory.types';
import {
  computeCorrectionPreview,
  correctionDelta,
  isLargeChange,
  parseSignedInteger,
} from './stock-correction-preview';

function channel(
  id: string,
  name: string,
  rule: { stockSafetyBuffer: number; stockZeroThreshold: number } | null,
): StockViewChannel {
  return {
    connectionId: id,
    connectionName: name,
    platformType: name.toLowerCase(),
    rule,
    willPublish: { quantity: null, provenance: 'computed' },
    channelShows: { quantity: null, observedAt: null },
  };
}

function variant(overrides: Partial<StockViewVariant>): StockViewVariant {
  return {
    productVariantId: 'v1',
    sku: 'KCN-350-GRY',
    attributes: {},
    masterAvailable: 6,
    masterReserved: 0,
    availableToPromise: 4,
    provenance: 'computed',
    observedAt: null,
    stalenessMs: null,
    olHeldNotReflected: null,
    heldCounted: 2,
    heldRecordedOnly: 0,
    livePositionCount: 1,
    isStaleSync: false,
    positions: [],
    holds: [],
    channels: [
      channel('c-allegro', 'Allegro', { stockSafetyBuffer: 2, stockZeroThreshold: 0 }),
      channel('c-erli', 'Erli', { stockSafetyBuffer: 0, stockZeroThreshold: 5 }),
    ],
    ...overrides,
  };
}

describe('computeCorrectionPreview', () => {
  it('should start from available to promise and apply each channel rule (M25/M6 example)', () => {
    const preview = computeCorrectionPreview({
      newMasterQuantity: 9,
      currentQuantity: 6,
      stock: variant({}),
    });

    expect(preview.availableToPromise).toBe(7);
    expect(preview.channels.map((c) => [c.connectionName, c.quantity])).toEqual([
      ['Allegro', 5],
      ['Erli', 7],
    ]);
  });

  it('should publish 0 below a zero threshold and never go negative', () => {
    const preview = computeCorrectionPreview({
      newMasterQuantity: 6,
      currentQuantity: 6,
      stock: variant({}),
    });

    // atp 4: Allegro 4-2=2, Erli threshold 5 -> 0
    expect(preview.channels.map((c) => c.quantity)).toEqual([2, 0]);
    expect(
      computeCorrectionPreview({ newMasterQuantity: 1, currentQuantity: 6, stock: variant({}) })
        .availableToPromise,
    ).toBe(0);
  });

  it('should report Unknown instead of a number when the held count is unknown', () => {
    const preview = computeCorrectionPreview({
      newMasterQuantity: 9,
      currentQuantity: 6,
      stock: variant({ heldCounted: null }),
    });

    expect(preview.availableToPromise).toBeNull();
    expect(preview.channels.every((c) => c.quantity === null)).toBe(true);
  });

  it('should treat a channel without a rule as a pass-through', () => {
    const preview = computeCorrectionPreview({
      newMasterQuantity: 9,
      currentQuantity: 6,
      stock: variant({ channels: [channel('c', 'Woo', null)] }),
    });

    expect(preview.channels[0]?.quantity).toBe(7);
  });

  it('should return no channels when the stock view is unavailable', () => {
    const preview = computeCorrectionPreview({ newMasterQuantity: 9, currentQuantity: 6, stock: null });

    expect(preview.availableToPromise).toBeNull();
    expect(preview.channels).toEqual([]);
  });
});

describe('large change and parsing', () => {
  it('should flag more than 50 units or more than half of a non-zero stock', () => {
    expect(isLargeChange(51, 500)).toBe(true);
    expect(isLargeChange(50, 500)).toBe(false);
    expect(isLargeChange(4, 6)).toBe(true);
    expect(isLargeChange(3, 6)).toBe(false);
    expect(isLargeChange(4, 0)).toBe(false);
  });

  it('should compute the delta for both modes', () => {
    expect(correctionDelta('set', 9, 6)).toBe(3);
    expect(correctionDelta('delta', -2, 6)).toBe(-2);
  });

  it('should parse signed integers including a typographic minus', () => {
    expect(parseSignedInteger('+3')).toBe(3);
    expect(parseSignedInteger('−2')).toBe(-2);
    expect(parseSignedInteger('1.5')).toBeNull();
    expect(parseSignedInteger('')).toBeNull();
  });
});
