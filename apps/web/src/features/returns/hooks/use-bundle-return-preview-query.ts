/**
 * useBundleReturnPreviewQuery (#3933)
 *
 * Prices a (partial) return of one bundle line: each component's share of the
 * set price and the Allegro-formula refund hint. A read - nothing is written -
 * keyed by the selection so ticking a component re-asks instead of reusing a
 * stale split.
 *
 * @module apps/web/src/features/returns/hooks
 */
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { returnsQueryKeys } from '../api/returns.query-keys';
import type { BundleReturnPreview } from '../api/returns.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useBundleReturnPreviewQuery(
  returnId: string,
  lineId: string,
  selection: { returnedVariantIds?: string[]; quantity?: number },
  enabled = true
): UseQueryResult<BundleReturnPreview, Error> {
  const apiClient = useApiClient();
  const key = `${[...(selection.returnedVariantIds ?? [])].sort().join(',')}|${selection.quantity ?? 1}`;

  return useQuery<BundleReturnPreview, Error>({
    queryKey: returnsQueryKeys.bundlePreview(returnId, lineId, key),
    queryFn: () => apiClient.returns.getBundleReturnPreview(returnId, lineId, selection),
    enabled,
    staleTime: 30_000,
    // Ticking a component re-asks; keeping the last answer on screen stops the
    // picker unmounting (and losing the operator's selection) while it loads.
    placeholderData: keepPreviousData,
  });
}
