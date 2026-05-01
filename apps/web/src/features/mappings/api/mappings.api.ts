/**
 * Mappings API Client
 *
 * Typed API methods for connection-scoped mapping configuration endpoints.
 *
 * Option lists (carriers, order statuses, payment methods, delivery methods)
 * collapse into a single parameterised call against the new capability-scoped
 * routes (#472): `/connections/:id/mappings/options/:side/:kind`. The `side`
 * indicates whether to resolve the destination (e.g. PrestaShop) or source
 * (e.g. Allegro) adapter — the connection alone disambiguates the platform.
 *
 * Categories keep dedicated methods because they return richer DTOs (tree
 * metadata) and use a different upstream architecture (cached browse).
 *
 * @module apps/web/src/features/mappings/api
 */

import type {
  StatusMapping,
  CarrierMapping,
  PaymentMapping,
  CategoryMapping,
  AllegroCategory,
  PrestashopCategory,
  MappingOption,
  MappingSide,
  MappingOptionKind,
  UpsertStatusMappingsPayload,
  UpsertCarrierMappingsPayload,
  UpsertPaymentMappingsPayload,
  UpsertCategoryMappingPayload,
} from './mappings.types';

export interface MappingsApi {
  getStatusMappings: (connectionId: string) => Promise<StatusMapping[]>;
  upsertStatusMappings: (connectionId: string, payload: UpsertStatusMappingsPayload) => Promise<StatusMapping[]>;

  getCarrierMappings: (connectionId: string) => Promise<CarrierMapping[]>;
  upsertCarrierMappings: (connectionId: string, payload: UpsertCarrierMappingsPayload) => Promise<CarrierMapping[]>;

  getPaymentMappings: (connectionId: string) => Promise<PaymentMapping[]>;
  upsertPaymentMappings: (connectionId: string, payload: UpsertPaymentMappingsPayload) => Promise<PaymentMapping[]>;

  /**
   * Fetch a dropdown option list from the resolved capability adapter.
   * Valid combos (rejected as 404 by the API otherwise):
   *   destination + (carriers | order-statuses | payment-methods)
   *   source      + (order-statuses | delivery-methods | payment-methods)
   */
  getMappingOptions: (
    connectionId: string,
    side: MappingSide,
    kind: MappingOptionKind,
  ) => Promise<MappingOption[]>;

  getCategoryMappings: (connectionId: string) => Promise<CategoryMapping[]>;
  upsertCategoryMapping: (connectionId: string, prestashopCategoryId: string, payload: UpsertCategoryMappingPayload) => Promise<CategoryMapping>;
  deleteCategoryMapping: (connectionId: string, prestashopCategoryId: string) => Promise<void>;
  getAllegroCategories: (connectionId: string, parentId?: string) => Promise<AllegroCategory[]>;
  getPrestashopCategories: (connectionId: string) => Promise<PrestashopCategory[]>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export function createMappingsApi(request: ApiRequest): MappingsApi {
  return {
    getStatusMappings: (connectionId) =>
      request<StatusMapping[]>(`/connections/${connectionId}/mappings/status`),

    upsertStatusMappings: (connectionId, payload) =>
      request<StatusMapping[]>(`/connections/${connectionId}/mappings/status`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),

    getCarrierMappings: (connectionId) =>
      request<CarrierMapping[]>(`/connections/${connectionId}/mappings/carriers`),

    upsertCarrierMappings: (connectionId, payload) =>
      request<CarrierMapping[]>(`/connections/${connectionId}/mappings/carriers`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),

    getPaymentMappings: (connectionId) =>
      request<PaymentMapping[]>(`/connections/${connectionId}/mappings/payments`),

    upsertPaymentMappings: (connectionId, payload) =>
      request<PaymentMapping[]>(`/connections/${connectionId}/mappings/payments`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),

    getMappingOptions: (connectionId, side, kind) =>
      request<MappingOption[]>(
        `/connections/${connectionId}/mappings/options/${side}/${kind}`,
      ),

    getCategoryMappings: (connectionId) =>
      request<CategoryMapping[]>(`/connections/${connectionId}/mappings/categories`),

    upsertCategoryMapping: (connectionId, prestashopCategoryId, payload) =>
      request<CategoryMapping>(`/connections/${connectionId}/mappings/categories/${prestashopCategoryId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),

    deleteCategoryMapping: (connectionId, prestashopCategoryId) =>
      request<void>(`/connections/${connectionId}/mappings/categories/${prestashopCategoryId}`, {
        method: 'DELETE',
      }),

    getAllegroCategories: (connectionId, parentId?) => {
      const qs = parentId ? `?parentId=${encodeURIComponent(parentId)}` : '';
      return request<AllegroCategory[]>(
        `/connections/${connectionId}/mappings/options/source/categories${qs}`,
      );
    },

    getPrestashopCategories: (connectionId) =>
      request<PrestashopCategory[]>(
        `/connections/${connectionId}/mappings/options/destination/categories`,
      ),
  };
}
