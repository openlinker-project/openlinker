import { describe, expect, it } from 'vitest';
import type { BuyerDataAgeHistogram, BuyerDataPreview } from '../api/buyer-data.types';
import { computeZoneCounts } from './zone-counts';

const cuts = { hideAfterDays: 180, eraseAfterDays: 365 };

const bucket = (ageMonths: number, visible: number, hidden: number, erased: number) => ({
  ageMonths,
  visible,
  hidden,
  erased,
});

function histogramOf(buckets: ReturnType<typeof bucket>[]): BuyerDataAgeHistogram {
  const totalOrders = buckets.reduce((n, b) => n + b.visible + b.hidden + b.erased, 0);
  return { bucketUnit: 'month', buckets, totalOrders, oldestPlacedAt: null };
}

function planOf(partial: Partial<BuyerDataPreview>) {
  return {
    fresh: true,
    calculating: false,
    data: {
      toHide: 0,
      toErase: 0,
      alreadyHiddenDueForErase: 0,
      total: 0,
      totalOrders: 0,
      skippedProtected: 0,
      skippedByReason: { openReturn: 0, hold: 0, invoicePending: 0 },
      samples: [],
      ...partial,
    },
  };
}

describe('computeZoneCounts', () => {
  it('should count an already hidden order past the erase cut once, in the erased zone', () => {
    // 10 young visible, 5 hidden and 3 visible past the erase cut, 2 hidden past it.
    const histogram = histogramOf([bucket(1, 10, 0, 0), bucket(14, 3, 2, 0)]);
    // visible candidates: 3 (erase), hidden candidates due for erase: 2.
    const plan = planOf({ toErase: 5, total: 5, alreadyHiddenDueForErase: 2, totalOrders: 13 });

    const counts = computeZoneCounts(plan, histogram, cuts);

    expect(counts).toMatchObject({ kept: 10, hidden: 0, erased: 5, alreadyHidden: 0 });
    expect(counts!.kept + counts!.hidden + counts!.erased).toBe(histogram.totalOrders);
  });

  it('should keep hidden orders younger than the erase cut in the hidden zone and sum to the total', () => {
    const histogram = histogramOf([bucket(1, 10, 0, 0), bucket(8, 4, 3, 0), bucket(14, 2, 1, 6)]);
    const plan = planOf({
      toHide: 4,
      toErase: 3,
      alreadyHiddenDueForErase: 1,
      total: 7,
      totalOrders: 16,
    });

    const counts = computeZoneCounts(plan, histogram, cuts)!;

    expect(counts.alreadyHidden).toBe(3);
    expect(counts.hidden).toBe(4 + 3);
    expect(counts.erased).toBe(3 + 6);
    expect(counts.kept + counts.hidden + counts.erased).toBe(histogram.totalOrders);
  });

  it('should not count an erased but still visible order as kept', () => {
    // In the histogram an erased order has its own bucket value, never also "visible".
    const histogram = histogramOf([bucket(1, 5, 0, 0), bucket(14, 0, 0, 4)]);
    const plan = planOf({ totalOrders: 9 });

    const counts = computeZoneCounts(plan, histogram, cuts)!;

    expect(counts.kept).toBe(5);
    expect(counts.erased).toBe(4);
  });

  it('should estimate the already hidden figure from buckets in the hidden zone only', () => {
    const histogram = histogramOf([bucket(8, 0, 3, 0), bucket(14, 0, 2, 0)]);

    const counts = computeZoneCounts(undefined, histogram, cuts)!;

    expect(counts.estimated).toBe(true);
    expect(counts.alreadyHidden).toBe(3);
  });
});
