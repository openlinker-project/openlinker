/**
 * Mapping Options Hook
 *
 * Fetches all 6 dropdown option lists in parallel for a given connection.
 * Returns a combined MappingOptions bundle plus loading state and a per-bundle
 * error record. Failures are isolated per bundle key (#484): if Allegro
 * payment-providers fail, the operator can still configure Order Statuses and
 * Carriers — only the affected panel renders an inline error.
 *
 * Each query has its own (side, kind) key so a single panel's options can
 * be invalidated independently when needed.
 *
 * @module apps/web/src/features/mappings/hooks
 */

import { useQueries } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { mappingsQueryKeys } from '../api/mappings.query-keys';
import type { MappingOptions, MappingSide, MappingOptionListKind } from '../api/mappings.types';

export type MappingOptionsErrors = Partial<Record<keyof MappingOptions, Error>>;

interface UseMappingOptionsResult {
  options: MappingOptions;
  isLoading: boolean;
  errors: MappingOptionsErrors;
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
  kind: MappingOptionListKind;
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
  const options: MappingOptions = { ...EMPTY_OPTIONS };
  const errors: MappingOptionsErrors = {};
  results.forEach((result, index) => {
    const { bundleKey } = QUERY_SPEC[index];
    options[bundleKey] = result.data ?? [];
    if (result.error instanceof Error) {
      errors[bundleKey] = result.error;
    }
  });

  return { options, isLoading, errors };
}
