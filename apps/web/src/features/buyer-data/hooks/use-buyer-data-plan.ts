/**
 * Buyer Data Plan (#4289)
 *
 * What a set of rules WOULD do, asked of the trial-run endpoint as the rules
 * change. It is the "plan" the studio shows and the proof that unlocks the
 * master switch: the numbers on screen are always the ones for the rules on
 * screen, or they are marked as being recomputed.
 *
 * Debounced (a drag fires many values), the previous request is aborted by
 * TanStack Query's signal, and invalid rules are never sent. While the new
 * answer is on its way the previous one stays readable but is flagged
 * `calculating`, and nothing is ever reported as zero for want of an answer.
 *
 * @module apps/web/src/features/buyer-data/hooks
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useDebouncedValue } from '../../../shared/hooks/use-debounced-value';
import { buyerDataQueryKeys } from '../api/buyer-data.query-keys';
import type { BuyerDataPreview, BuyerDataPreviewInput } from '../api/buyer-data.types';
import { validateBuyerDataRules } from '../lib/buyer-data-config';

export const PLAN_DEBOUNCE_MS = 300;

export interface BuyerDataPlan {
  data: BuyerDataPreview | undefined;
  /** The answer is for other rules than the ones on screen, or is on its way. */
  calculating: boolean;
  /** An answer exists and it is for exactly the rules on screen. */
  fresh: boolean;
  isError: boolean;
  /** ISO instant the shown answer arrived. */
  computedAt: string | undefined;
}

export function useBuyerDataPlan(
  input: BuyerDataPreviewInput,
  options: { enabled?: boolean } = {}
): BuyerDataPlan {
  const apiClient = useApiClient();
  const debounced = useDebouncedValue(input, PLAN_DEBOUNCE_MS);
  const valid = validateBuyerDataRules(debounced).length === 0;
  const query = useQuery({
    queryKey: buyerDataQueryKeys.plan(debounced),
    queryFn: ({ signal }) => apiClient.buyerData.preview(debounced, signal),
    enabled: (options.enabled ?? true) && valid,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const settled =
    debounced.hideAfterDays === input.hideAfterDays &&
    debounced.eraseAfterDays === input.eraseAfterDays &&
    debounced.mode === input.mode &&
    debounced.connectionId === input.connectionId;
  const calculating = !settled || query.isPlaceholderData || (valid && query.isFetching);
  return {
    data: query.data,
    calculating,
    fresh:
      settled && valid && !query.isPlaceholderData && !query.isError && query.data !== undefined,
    isError: query.isError && settled,
    computedAt: query.dataUpdatedAt > 0 ? new Date(query.dataUpdatedAt).toISOString() : undefined,
  };
}
