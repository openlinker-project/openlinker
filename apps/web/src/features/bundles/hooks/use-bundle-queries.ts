/**
 * Bundle reads (#3624): the definition with availability, its history, and the
 * bundles a product is used in. A 404 on the definition means "not a bundle",
 * which is an answer rather than a failure, so it is not retried.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { bundlesQueryKeys } from '../api/bundles.query-keys';
import type { BundleDetail, BundleHistoryEntry, BundleUsedIn } from '../api/bundles.types';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { ApiError } from '../../../shared/api/api-error';

export function useBundleQuery(variantId: string | undefined): UseQueryResult<BundleDetail, ApiError> {
  const apiClient = useApiClient();
  return useQuery<BundleDetail, ApiError>({
    queryKey: bundlesQueryKeys.detail(variantId ?? ''),
    queryFn: () => apiClient.bundles.get(variantId ?? ''),
    enabled: Boolean(variantId),
    retry: false,
  });
}

export function useBundleHistoryQuery(
  variantId: string | undefined,
  enabled: boolean,
): UseQueryResult<BundleHistoryEntry[], ApiError> {
  const apiClient = useApiClient();
  return useQuery<BundleHistoryEntry[], ApiError>({
    queryKey: bundlesQueryKeys.history(variantId ?? ''),
    queryFn: () => apiClient.bundles.history(variantId ?? ''),
    enabled: Boolean(variantId) && enabled,
    retry: false,
  });
}

export function useBundleUsedInQuery(
  variantId: string | undefined,
): UseQueryResult<BundleUsedIn[], ApiError> {
  const apiClient = useApiClient();
  return useQuery<BundleUsedIn[], ApiError>({
    queryKey: bundlesQueryKeys.usedIn(variantId ?? ''),
    queryFn: () => apiClient.bundles.usedIn(variantId ?? ''),
    enabled: Boolean(variantId),
    retry: false,
    staleTime: 30_000,
  });
}

/** The bundles any of these variants is a component of; one request, cached by the variant list. */
export function useBundleUsedInManyQuery(
  variantIds: readonly string[],
): UseQueryResult<BundleUsedIn[], ApiError> {
  const apiClient = useApiClient();
  return useQuery<BundleUsedIn[], ApiError>({
    queryKey: bundlesQueryKeys.usedInMany(variantIds),
    queryFn: () => apiClient.bundles.usedInMany(variantIds),
    enabled: variantIds.length > 0,
    retry: false,
    staleTime: 30_000,
  });
}
