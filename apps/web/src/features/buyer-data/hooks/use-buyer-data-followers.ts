/**
 * Buyer Data Followers (#4289)
 *
 * The Defaults tab describes what the DEFAULT rules do, and a connection with
 * rules of its own is swept by those, not by the defaults. Counting every order
 * (what an unscoped request does) would therefore promise an outcome the job
 * never produces for the default scope. These hooks ask per connection that
 * still FOLLOWS the defaults and add the answers up, so the numbers on screen
 * are the ones the job will act on.
 *
 * An empty list is a real answer (nobody follows the defaults) and reads as
 * zeros, not as "unknown".
 *
 * @module apps/web/src/features/buyer-data/hooks
 */
import { keepPreviousData, useQueries } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useDebouncedValue } from '../../../shared/hooks/use-debounced-value';
import { buyerDataQueryKeys } from '../api/buyer-data.query-keys';
import type {
  BuyerDataAgeBucket,
  BuyerDataAgeHistogram,
  BuyerDataEraseMode,
  BuyerDataPreview,
} from '../api/buyer-data.types';
import { validateBuyerDataRules } from '../lib/buyer-data-config';
import { PLAN_DEBOUNCE_MS, type BuyerDataPlan } from './use-buyer-data-plan';

const SAMPLE_LIMIT = 5;

const EMPTY_PREVIEW: BuyerDataPreview = {
  toHide: 0,
  toErase: 0,
  alreadyHiddenDueForErase: 0,
  total: 0,
  totalOrders: 0,
  skippedProtected: 0,
  skippedByReason: { openReturn: 0, hold: 0, invoicePending: 0 },
  samples: [],
};

export function sumPreviews(previews: readonly BuyerDataPreview[]): BuyerDataPreview {
  return previews.reduce<BuyerDataPreview>(
    (sum, p) => ({
      toHide: sum.toHide + p.toHide,
      toErase: sum.toErase + p.toErase,
      alreadyHiddenDueForErase: sum.alreadyHiddenDueForErase + p.alreadyHiddenDueForErase,
      total: sum.total + p.total,
      totalOrders: sum.totalOrders + p.totalOrders,
      skippedProtected: sum.skippedProtected + p.skippedProtected,
      skippedByReason: {
        openReturn: sum.skippedByReason.openReturn + p.skippedByReason.openReturn,
        hold: sum.skippedByReason.hold + p.skippedByReason.hold,
        invoicePending: sum.skippedByReason.invoicePending + p.skippedByReason.invoicePending,
      },
      samples: [...sum.samples, ...p.samples].slice(0, SAMPLE_LIMIT),
    }),
    EMPTY_PREVIEW
  );
}

export function sumHistograms(histograms: readonly BuyerDataAgeHistogram[]): BuyerDataAgeHistogram {
  const byMonth = new Map<number, BuyerDataAgeBucket>();
  let oldest: string | null = null;
  for (const histogram of histograms) {
    for (const bucket of histogram.buckets) {
      const current = byMonth.get(bucket.ageMonths) ?? {
        ageMonths: bucket.ageMonths,
        visible: 0,
        hidden: 0,
        erased: 0,
      };
      byMonth.set(bucket.ageMonths, {
        ageMonths: bucket.ageMonths,
        visible: current.visible + bucket.visible,
        hidden: current.hidden + bucket.hidden,
        erased: current.erased + bucket.erased,
      });
    }
    if (
      histogram.oldestPlacedAt !== null &&
      (oldest === null || histogram.oldestPlacedAt < oldest)
    ) {
      oldest = histogram.oldestPlacedAt;
    }
  }
  return {
    bucketUnit: 'month',
    buckets: [...byMonth.values()].sort((a, b) => a.ageMonths - b.ageMonths),
    totalOrders: histograms.reduce((sum, h) => sum + h.totalOrders, 0),
    oldestPlacedAt: oldest,
  };
}

export interface FollowersPlanInput {
  hideAfterDays: number;
  eraseAfterDays: number;
  mode: BuyerDataEraseMode;
}

export function useBuyerDataFollowersPlan(
  input: FollowersPlanInput,
  connectionIds: readonly string[],
  options: { enabled?: boolean } = {}
): BuyerDataPlan {
  const apiClient = useApiClient();
  const debounced = useDebouncedValue(input, PLAN_DEBOUNCE_MS);
  const valid = validateBuyerDataRules(debounced).length === 0;
  const enabled = (options.enabled ?? true) && valid;
  const results = useQueries({
    queries: connectionIds.map((connectionId) => ({
      queryKey: buyerDataQueryKeys.plan({ ...debounced, connectionId }),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        apiClient.buyerData.preview({ ...debounced, connectionId }, signal),
      enabled,
      placeholderData: keepPreviousData,
      staleTime: 30_000,
    })),
  });

  const settled =
    debounced.hideAfterDays === input.hideAfterDays &&
    debounced.eraseAfterDays === input.eraseAfterDays &&
    debounced.mode === input.mode;
  const answered = results.every((r) => r.data !== undefined);
  const anyError = results.some((r) => r.isError);
  const stale = results.some((r) => r.isPlaceholderData || r.isFetching);
  const data = answered
    ? sumPreviews(results.map((r) => r.data).filter((p): p is BuyerDataPreview => p !== undefined))
    : undefined;
  const updatedAt = Math.max(0, ...results.map((r) => r.dataUpdatedAt));

  return {
    data,
    calculating: !settled || (valid && stale),
    fresh: settled && valid && !stale && !anyError && answered,
    isError: anyError && settled,
    computedAt: updatedAt > 0 ? new Date(updatedAt).toISOString() : undefined,
  };
}

export function useBuyerDataFollowersHistogram(
  connectionIds: readonly string[],
  options: { enabled?: boolean } = {}
): { data: BuyerDataAgeHistogram | undefined; isError: boolean } {
  const apiClient = useApiClient();
  const results = useQueries({
    queries: connectionIds.map((connectionId) => ({
      queryKey: buyerDataQueryKeys.histogram(connectionId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        apiClient.buyerData.ageHistogram(connectionId, signal),
      enabled: options.enabled ?? true,
      staleTime: 60_000,
    })),
  });
  const answered = results.every((r) => r.data !== undefined);
  return {
    data: answered
      ? sumHistograms(
          results.map((r) => r.data).filter((h): h is BuyerDataAgeHistogram => h !== undefined)
        )
      : undefined,
    isError: results.some((r) => r.isError),
  };
}
