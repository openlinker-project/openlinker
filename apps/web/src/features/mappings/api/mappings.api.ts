/**
 * Mappings API Client
 *
 * Typed API methods for connection-scoped mapping configuration endpoints.
 *
 * @module apps/web/src/features/mappings/api
 */

import type {
  StatusMapping,
  CarrierMapping,
  PaymentMapping,
  CategoryMapping,
  AllegroCategory,
  MappingOption,
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

  getAllegroOrderStatuses: (connectionId: string) => Promise<MappingOption[]>;
  getAllegroDeliveryMethods: (connectionId: string) => Promise<MappingOption[]>;
  getAllegroPaymentProviders: (connectionId: string) => Promise<MappingOption[]>;
  getPrestashopOrderStatuses: (connectionId: string) => Promise<MappingOption[]>;
  getPrestashopCarriers: (connectionId: string) => Promise<MappingOption[]>;
  getPrestashopPaymentModules: (connectionId: string) => Promise<MappingOption[]>;

  getCategoryMappings: (connectionId: string) => Promise<CategoryMapping[]>;
  upsertCategoryMapping: (connectionId: string, prestashopCategoryId: string, payload: UpsertCategoryMappingPayload) => Promise<CategoryMapping>;
  deleteCategoryMapping: (connectionId: string, prestashopCategoryId: string) => Promise<void>;
  getAllegroCategories: (connectionId: string, parentId?: string) => Promise<AllegroCategory[]>;
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

    getAllegroOrderStatuses: (connectionId) =>
      request<MappingOption[]>(`/connections/${connectionId}/allegro/order-statuses`),

    getAllegroDeliveryMethods: (connectionId) =>
      request<MappingOption[]>(`/connections/${connectionId}/allegro/delivery-methods`),

    getAllegroPaymentProviders: (connectionId) =>
      request<MappingOption[]>(`/connections/${connectionId}/allegro/payment-providers`),

    getPrestashopOrderStatuses: (connectionId) =>
      request<MappingOption[]>(`/connections/${connectionId}/prestashop/order-statuses`),

    getPrestashopCarriers: (connectionId) =>
      request<MappingOption[]>(`/connections/${connectionId}/prestashop/carriers`),

    getPrestashopPaymentModules: (connectionId) =>
      request<MappingOption[]>(`/connections/${connectionId}/prestashop/payment-modules`),

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
      return request<AllegroCategory[]>(`/connections/${connectionId}/allegro/categories${qs}`);
    },
  };
}
