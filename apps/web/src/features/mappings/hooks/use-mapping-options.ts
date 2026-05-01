/**
 * Mapping Options Hook
 *
 * Fetches all 6 dropdown option lists in parallel for a given connection.
 * Returns a combined MappingOptions bundle plus loading/error state.
 *
 * Each query has its own (side, kind) key so a single panel's options can
 * be invalidated independently when needed.
 *
 * @module apps/web/src/features/mappings/hooks
 */

import { useQueries } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { mappingsQueryKeys } from '../api/mappings.query-keys';
import type { MappingOptions, MappingSide, MappingOptionKind } from '../api/mappings.types';

interface UseMappingOptionsResult {
  options: MappingOptions;
  isLoading: boolean;
  error: Error | null;
}

const EMPTY_OPTIONS: MappingOptions = {
  allegroOrderStatuses: [],
  allegroDeliveryMethods: [],
  allegroPaymentProviders: [],
  prestashopOrderStatuses: [],
  prestashopCarriers: [],
  prestashopPaymentModules: [],
};

const QUERY_SPEC: Array<{
  side: MappingSide;
  kind: MappingOptionKind;
  bundleKey: keyof MappingOptions;
}> = [
  { side: 'source', kind: 'order-statuses', bundleKey: 'allegroOrderStatuses' },
  { side: 'source', kind: 'delivery-methods', bundleKey: 'allegroDeliveryMethods' },
  { side: 'source', kind: 'payment-methods', bundleKey: 'allegroPaymentProviders' },
  { side: 'destination', kind: 'order-statuses', bundleKey: 'prestashopOrderStatuses' },
  { side: 'destination', kind: 'carriers', bundleKey: 'prestashopCarriers' },
  { side: 'destination', kind: 'payment-methods', bundleKey: 'prestashopPaymentModules' },
];

export function useMappingOptions(connectionId: string): UseMappingOptionsResult {
  const apiClient = useApiClient();

  const results = useQueries({
    queries: QUERY_SPEC.map(({ side, kind }) => ({
      queryKey: mappingsQueryKeys.option(connectionId, side, kind),
      queryFn: () => apiClient.mappings.getMappingOptions(connectionId, side, kind),
    })),
  });

  const isLoading = results.some((r) => r.isLoading);
  const firstError = results.find((r) => r.error)?.error ?? null;

  if (isLoading) {
    return { options: EMPTY_OPTIONS, isLoading, error: firstError instanceof Error ? firstError : null };
  }

  const options: MappingOptions = { ...EMPTY_OPTIONS };
  results.forEach((result, index) => {
    options[QUERY_SPEC[index].bundleKey] = result.data ?? [];
  });

  return { options, isLoading, error: firstError instanceof Error ? firstError : null };
}
