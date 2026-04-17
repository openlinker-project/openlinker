/**
 * Mapping Options Hook
 *
 * Fetches all 6 dropdown option lists in parallel for a given connection.
 * Returns a combined MappingOptions bundle plus loading/error state.
 *
 * @module apps/web/src/features/mappings/hooks
 */

import { useQueries } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { mappingsQueryKeys } from '../api/mappings.query-keys';
import type { MappingOptions } from '../api/mappings.types';

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

export function useMappingOptions(connectionId: string): UseMappingOptionsResult {
  const apiClient = useApiClient();

  const results = useQueries({
    queries: [
      {
        queryKey: [...mappingsQueryKeys.options(connectionId), 'allegro-statuses'],
        queryFn: () => apiClient.mappings.getAllegroOrderStatuses(connectionId),
      },
      {
        queryKey: [...mappingsQueryKeys.options(connectionId), 'allegro-delivery'],
        queryFn: () => apiClient.mappings.getAllegroDeliveryMethods(connectionId),
      },
      {
        queryKey: [...mappingsQueryKeys.options(connectionId), 'allegro-payments'],
        queryFn: () => apiClient.mappings.getAllegroPaymentProviders(connectionId),
      },
      {
        queryKey: [...mappingsQueryKeys.options(connectionId), 'ps-statuses'],
        queryFn: () => apiClient.mappings.getPrestashopOrderStatuses(connectionId),
      },
      {
        queryKey: [...mappingsQueryKeys.options(connectionId), 'ps-carriers'],
        queryFn: () => apiClient.mappings.getPrestashopCarriers(connectionId),
      },
      {
        queryKey: [...mappingsQueryKeys.options(connectionId), 'ps-payments'],
        queryFn: () => apiClient.mappings.getPrestashopPaymentModules(connectionId),
      },
    ],
  });

  const isLoading = results.some((r) => r.isLoading);
  const firstError = results.find((r) => r.error)?.error ?? null;

  const [
    allegroStatuses,
    allegroDelivery,
    allegroPayments,
    psStatuses,
    psCarriers,
    psPayments,
  ] = results;

  const options: MappingOptions = isLoading
    ? EMPTY_OPTIONS
    : {
        allegroOrderStatuses: allegroStatuses.data ?? [],
        allegroDeliveryMethods: allegroDelivery.data ?? [],
        allegroPaymentProviders: allegroPayments.data ?? [],
        prestashopOrderStatuses: psStatuses.data ?? [],
        prestashopCarriers: psCarriers.data ?? [],
        prestashopPaymentModules: psPayments.data ?? [],
      };

  return { options, isLoading, error: firstError instanceof Error ? firstError : null };
}
