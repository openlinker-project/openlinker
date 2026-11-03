/**
 * Delivery on documents - read hooks (#3908)
 *
 * Suggestions (per-country starting points) and country facts (what this
 * connection's orders actually look like). Both are enrichment: the table
 * renders from `connection.config` alone, so a failure here only removes a
 * suggestion or an example, never the settings.
 *
 * @module apps/web/src/features/delivery-on-documents/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { deliveryOnDocumentsQueryKeys } from '../api/delivery-on-documents.query-keys';
import type {
  DeliveryCountryFactsResponse,
  DeliveryLineSuggestionsResponse,
} from '../api/delivery-on-documents.types';

export function useDeliveryLineSuggestionsQuery(): UseQueryResult<DeliveryLineSuggestionsResponse> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: deliveryOnDocumentsQueryKeys.suggestions(),
    queryFn: () => apiClient.deliveryOnDocuments.getSuggestions(),
    staleTime: 10 * 60 * 1000,
  });
}

export function useDeliveryCountryFactsQuery(
  connectionId: string,
): UseQueryResult<DeliveryCountryFactsResponse> {
  const apiClient = useApiClient();
  return useQuery({
    enabled: connectionId.length > 0,
    queryKey: deliveryOnDocumentsQueryKeys.countryFacts(connectionId),
    queryFn: () => apiClient.deliveryOnDocuments.getCountryFacts(connectionId),
  });
}
