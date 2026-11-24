/**
 * Buyer Data Impact Query (#4289)
 *
 * The counts behind "how many orders does this touch": the trial-run endpoint
 * read as the rules change. Debounced so typing a custom period does not send a
 * request per keystroke, and disabled while the rules are not valid - the
 * server would only refuse them.
 *
 * @module apps/web/src/features/buyer-data/hooks
 */
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useDebouncedValue } from '../../../shared/hooks/use-debounced-value';
import { buyerDataQueryKeys } from '../api/buyer-data.query-keys';
import type { BuyerDataPreview, BuyerDataPreviewInput } from '../api/buyer-data.types';
import { validateBuyerDataRules } from '../lib/buyer-data-config';

const DEBOUNCE_MS = 400;

export function useBuyerDataImpactQuery(
  input: BuyerDataPreviewInput,
  options: { enabled?: boolean } = {}
): UseQueryResult<BuyerDataPreview, Error> {
  const apiClient = useApiClient();
  const debounced = useDebouncedValue(input, DEBOUNCE_MS);
  const valid = validateBuyerDataRules(debounced).length === 0;
  return useQuery({
    queryKey: buyerDataQueryKeys.impact(debounced),
    queryFn: () => apiClient.buyerData.preview(debounced),
    enabled: (options.enabled ?? true) && valid,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
