/**
 * useBundleRefundHintQuery (#3933)
 *
 * The Allegro-formula refund hint for a return whose bundles came back in parts.
 * A read; the hint is never applied by the page that shows it.
 *
 * @module apps/web/src/features/returns/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { returnsQueryKeys } from '../api/returns.query-keys';
import type { BundleRefundHint } from '../api/returns.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useBundleRefundHintQuery(
  returnId: string,
  enabled: boolean
): UseQueryResult<BundleRefundHint, Error> {
  const apiClient = useApiClient();
  return useQuery<BundleRefundHint, Error>({
    queryKey: returnsQueryKeys.bundleRefundHint(returnId),
    queryFn: () => apiClient.returns.getBundleRefundHint(returnId),
    enabled,
    retry: false,
  });
}
