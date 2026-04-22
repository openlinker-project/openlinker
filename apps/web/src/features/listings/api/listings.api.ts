/**
 * Listings API Client
 *
 * Thin API module for the listings (offer mapping) feature. Provides typed
 * methods for listing offer mappings and fetching individual mapping details.
 *
 * @module apps/web/src/features/listings/api
 */
import type {
  CreateOfferRequest,
  CreateOfferResponse,
  ListingsFilters,
  ListingsPagination,
  OfferCreationStatusResponse,
  OfferMapping,
  PaginatedOfferMappings,
  SellerPoliciesResponse,
  UpdateOfferFieldsPayload,
  UpdateOfferFieldsResult,
} from './listings.types';

export interface CreateOfferOptions {
  /**
   * Forwarded as `x-idempotency-key`. Reuse the same key across retries
   * within one wizard session so duplicate records are never created.
   */
  idempotencyKey?: string;
}

export interface ListingsApi {
  list: (filters?: ListingsFilters, pagination?: ListingsPagination) => Promise<PaginatedOfferMappings>;
  getById: (id: string) => Promise<OfferMapping>;
  updateOfferFields: (connectionId: string, offerId: string, fields: UpdateOfferFieldsPayload) => Promise<UpdateOfferFieldsResult>;
  createOffer: (
    connectionId: string,
    request: CreateOfferRequest,
    options?: CreateOfferOptions,
  ) => Promise<CreateOfferResponse>;
  getOfferCreationStatus: (
    connectionId: string,
    offerCreationRecordId: string,
  ) => Promise<OfferCreationStatusResponse>;
  getSellerPolicies: (connectionId: string) => Promise<SellerPoliciesResponse>;
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
    createOffer(connectionId, body, options): Promise<CreateOfferResponse> {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (options?.idempotencyKey) {
        headers['x-idempotency-key'] = options.idempotencyKey;
      }
      return request<CreateOfferResponse>(`/listings/connections/${connectionId}/offers`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    },
    getOfferCreationStatus(connectionId, offerCreationRecordId): Promise<OfferCreationStatusResponse> {
      return request<OfferCreationStatusResponse>(
        `/listings/connections/${connectionId}/offers/creation/${offerCreationRecordId}`,
      );
    },
    getSellerPolicies(connectionId): Promise<SellerPoliciesResponse> {
      return request<SellerPoliciesResponse>(`/listings/connections/${connectionId}/seller-policies`);
    },
  };
}
