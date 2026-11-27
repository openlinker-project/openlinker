/**
 * Delivery on documents - API client (#3908)
 *
 * Read-only. The settings themselves live in `connection.config` and are
 * written through the connections API (see `use-save-delivery-on-documents`).
 *
 * @module apps/web/src/features/delivery-on-documents/api
 */
import type {
  DeliveryCountryFactsResponse,
  DeliveryLineSuggestionsResponse,
} from './delivery-on-documents.types';

type ApiRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

export interface DeliveryOnDocumentsApi {
  getSuggestions: () => Promise<DeliveryLineSuggestionsResponse>;
  getCountryFacts: (connectionId: string) => Promise<DeliveryCountryFactsResponse>;
}

export function createDeliveryOnDocumentsApi(request: ApiRequest): DeliveryOnDocumentsApi {
  return {
    getSuggestions: () =>
      request<DeliveryLineSuggestionsResponse>('/sales-documents/delivery-line/suggestions'),
    getCountryFacts: (connectionId) =>
      request<DeliveryCountryFactsResponse>(
        `/connections/${encodeURIComponent(connectionId)}/delivery-line/country-facts`,
      ),
  };
}
