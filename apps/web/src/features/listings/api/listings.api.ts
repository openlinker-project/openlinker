/**
 * Listings API Client
 *
 * Thin API module for the listings (offer mapping) feature. Provides typed
 * methods for listing offer mappings and fetching individual mapping details.
 *
 * @module apps/web/src/features/listings/api
 */
import type {
  ListingsFilters,
  ListingsPagination,
  OfferMapping,
  PaginatedOfferMappings,
  UpdateOfferFieldsPayload,
  UpdateOfferFieldsResult,
} from './listings.types';

export interface ListingsApi {
  list: (filters?: ListingsFilters, pagination?: ListingsPagination) => Promise<PaginatedOfferMappings>;
  getById: (id: string) => Promise<OfferMapping>;
  updateOfferFields: (connectionId: string, offerId: string, fields: UpdateOfferFieldsPayload) => Promise<UpdateOfferFieldsResult>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(filters?: ListingsFilters, pagination?: ListingsPagination): string {
  const params = new URLSearchParams();
  if (filters?.connectionId) params.set('connectionId', filters.connectionId);
  if (filters?.platformType) params.set('platformType', filters.platformType);
  if (filters?.internalId) params.set('internalId', filters.internalId);
  if (filters?.search) params.set('search', filters.search);
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
  if (pagination?.offset !== undefined) params.set('offset', String(pagination.offset));
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export function createListingsApi(request: ApiRequest): ListingsApi {
  return {
    list(filters, pagination): Promise<PaginatedOfferMappings> {
      return request<PaginatedOfferMappings>(`/listings${buildQuery(filters, pagination)}`);
    },
    getById(id): Promise<OfferMapping> {
      return request<OfferMapping>(`/listings/${id}`);
    },
    updateOfferFields(connectionId, offerId, fields): Promise<UpdateOfferFieldsResult> {
      return request<UpdateOfferFieldsResult>(
        `/listings/connections/${connectionId}/offers/${offerId}/fields`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fields),
        },
      );
    },
  };
}
