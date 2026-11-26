/**
 * Zone counts (#4289)
 *
 * The three numbers under the age strip (kept, hidden, erased) and the "of which
 * already done" figures, from the server's plan and the age histogram.
 *
 * Each order is in exactly one zone. The two sources overlap, which is the whole
 * reason this is a function with tests: the plan counts an already-hidden order
 * past the erase cut as something to erase, and the histogram reports the same
 * order as hidden. It is shown once, in the Erased zone.
 *
 * @module apps/web/src/features/buyer-data/lib
 */
import type { BuyerDataAgeHistogram, BuyerDataPreview } from '../api/buyer-data.types';
import { estimateAlreadyHidden, estimateZoneCounts, type RetentionCuts } from './retention-scale';

export interface ZoneCountsResult {
  kept: number;
  hidden: number;
  erased: number;
  /** Of `hidden` / `erased`: orders the retention job (or an operator) already processed. */
  alreadyHidden: number;
  alreadyErased: number;
  estimated: boolean;
  calculating: boolean;
}

export interface ZoneCountsPlan {
  data: BuyerDataPreview | undefined;
  fresh: boolean;
  calculating: boolean;
}

export function computeZoneCounts(
  plan: ZoneCountsPlan | null | undefined,
  histogram: BuyerDataAgeHistogram | undefined,
  cuts: RetentionCuts
): ZoneCountsResult | null {
  let hiddenInHistogram = 0;
  let alreadyErased = 0;
  let stillVisible = 0;
  for (const bucket of histogram?.buckets ?? []) {
    hiddenInHistogram += bucket.hidden;
    alreadyErased += bucket.erased;
    stillVisible += bucket.visible;
  }

  if (plan?.fresh === true && plan.data !== undefined) {
    const { totalOrders, total, toErase, alreadyHiddenDueForErase } = plan.data;
    const alreadyHidden = Math.max(0, hiddenInHistogram - alreadyHiddenDueForErase);
    // The histogram's visible bucket is neither hidden nor erased, so unlike
    // `totalOrders` it never counts an erased order a second time.
    const visibleBefore = histogram === undefined ? totalOrders : stillVisible;
    return {
      kept: Math.max(0, visibleBefore - (total - alreadyHiddenDueForErase)),
      hidden: Math.max(0, total - toErase) + alreadyHidden,
      erased: toErase + alreadyErased,
      alreadyHidden,
      alreadyErased,
      estimated: false,
      calculating: false,
    };
  }
  if (histogram !== undefined) {
    return {
      ...estimateZoneCounts(histogram.buckets, cuts),
      alreadyHidden: estimateAlreadyHidden(histogram.buckets, cuts),
      alreadyErased,
      estimated: true,
      calculating: plan?.calculating ?? false,
    };
  }
  if (plan?.data !== undefined) {
    const { totalOrders, total, toErase, alreadyHiddenDueForErase } = plan.data;
    return {
      kept: Math.max(0, totalOrders - (total - alreadyHiddenDueForErase)),
      hidden: Math.max(0, total - toErase),
      erased: toErase,
      alreadyHidden: 0,
      alreadyErased: 0,
      estimated: true,
      calculating: true,
    };
  }
  return null;
}
