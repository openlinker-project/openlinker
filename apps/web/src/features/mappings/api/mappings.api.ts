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
  OrderStateMapping,
  CategoryMapping,
  AllegroCategory,
  CategoryPathNode,
  CategorySearchHit,
  PrestashopCategory,
  MappingOption,
  MappingSide,
  MappingOptionListKind,
  UpsertStatusMappingsPayload,
  UpsertCarrierMappingsPayload,
  UpsertPaymentMappingsPayload,
  UpsertOrderStateMappingsPayload,
  UpsertCategoryMappingPayload,
  RoutingRule,
  CandidateProcessor,
  UpsertRoutingRulesPayload,
  AttributeRule,
  UpsertAttributeRulePayload,
} from './mappings.types';

/**
 * Wire shape of one search hit (#2075).
 *
 * Distinct from the domain `CategorySearchHit` in exactly one field: the API's
 * `leaf` is `boolean | null` (null for a shop node, which has no leaf concept)
 * while consumers want a plain boolean. Declaring the wire shape explicitly is
 * what makes that normalisation a visible mapping step rather than a cast.
 */
interface TaxonomySearchHitWire {
  category: { id: string; name: string; parentId: string | null; leaf: boolean | null };
  path: CategoryPathNode[];
}

export interface MappingsApi {
  getStatusMappings: (connectionId: string) => Promise<StatusMapping[]>;
  upsertStatusMappings: (connectionId: string, payload: UpsertStatusMappingsPayload) => Promise<StatusMapping[]>;

  getCarrierMappings: (connectionId: string) => Promise<CarrierMapping[]>;
  upsertCarrierMappings: (connectionId: string, payload: UpsertCarrierMappingsPayload) => Promise<CarrierMapping[]>;

  getPaymentMappings: (connectionId: string) => Promise<PaymentMapping[]>;
  upsertPaymentMappings: (connectionId: string, payload: UpsertPaymentMappingsPayload) => Promise<PaymentMapping[]>;

  getOrderStateMappings: (connectionId: string) => Promise<OrderStateMapping[]>;
  upsertOrderStateMappings: (connectionId: string, payload: UpsertOrderStateMappingsPayload) => Promise<OrderStateMapping[]>;

  /**
   * Fetch a dropdown option list from the resolved capability adapter.
   * Valid combos (rejected as 404 by the API otherwise):
   *   destination + (carriers | order-statuses | payment-methods)
   *   source      + (order-statuses | delivery-methods | payment-methods)
   */
  getMappingOptions: (
    connectionId: string,
    side: MappingSide,
    kind: MappingOptionListKind,
  ) => Promise<MappingOption[]>;

  getCategoryMappings: (connectionId: string) => Promise<CategoryMapping[]>;
  upsertCategoryMapping: (connectionId: string, prestashopCategoryId: string, payload: UpsertCategoryMappingPayload) => Promise<CategoryMapping>;
  deleteCategoryMapping: (connectionId: string, prestashopCategoryId: string) => Promise<void>;
  getAllegroCategories: (connectionId: string, parentId?: string) => Promise<AllegroCategory[]>;
  getCategoryPath: (connectionId: string, categoryId: string) => Promise<CategoryPathNode[]>;
  /**
   * Whole-tree category search (#2075) against the neutral destination-taxonomy
   * projection (#2074). Serves marketplace AND shop connections - scope is
   * resolved from the connection, never from a platform name.
   */
  searchCategories: (
    connectionId: string,
    query: string,
    limit?: number,
  ) => Promise<CategorySearchHit[]>;
  getPrestashopCategories: (connectionId: string) => Promise<PrestashopCategory[]>;

  // Fulfillment routing (#836) — sibling of /mappings, keyed on the source connection.
  getRoutingRules: (connectionId: string) => Promise<RoutingRule[]>;
  replaceRoutingRules: (
    connectionId: string,
    payload: UpsertRoutingRulesPayload,
  ) => Promise<RoutingRule[]>;
  getRoutingCandidates: (connectionId: string) => Promise<CandidateProcessor[]>;

  // Attribute mapping rules (#1841) — operator-authored, deterministic rule layer.
  getAttributeRules: (connectionId: string) => Promise<AttributeRule[]>;
  upsertAttributeRule: (
    connectionId: string,
    payload: UpsertAttributeRulePayload,
  ) => Promise<AttributeRule>;
  deleteAttributeRule: (connectionId: string, ruleId: string) => Promise<void>;
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

    getOrderStateMappings: (connectionId) =>
      request<OrderStateMapping[]>(`/connections/${connectionId}/mappings/order-states`),

    upsertOrderStateMappings: (connectionId, payload) =>
      request<OrderStateMapping[]>(`/connections/${connectionId}/mappings/order-states`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),

    getRoutingRules: (connectionId) =>
      request<RoutingRule[]>(`/connections/${connectionId}/routing-rules`),

    replaceRoutingRules: (connectionId, payload) =>
      request<RoutingRule[]>(`/connections/${connectionId}/routing-rules`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),

    getRoutingCandidates: (connectionId) =>
      request<CandidateProcessor[]>(`/connections/${connectionId}/routing-rules/candidates`),

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

    getCategoryPath: (connectionId, categoryId) =>
      request<CategoryPathNode[]>(
        `/connections/${connectionId}/mappings/options/source/categories/${encodeURIComponent(
          categoryId,
        )}/path`,
      ),

    getPrestashopCategories: (connectionId) =>
      request<PrestashopCategory[]>(
        `/connections/${connectionId}/mappings/options/destination/categories`,
      ),

    searchCategories: async (connectionId, query, limit) => {
      const params = new URLSearchParams({ q: query });
      if (limit !== undefined) params.set('limit', String(limit));

      // `leaf` is nullable on the wire - a shop node has no leaf concept
      // (ADR-024), only a marketplace one does. Normalising to `false` here
      // keeps every consumer free of null handling: a shop picker never
      // leaf-gates selection, so the substituted value is unreachable there.
      const hits = await request<TaxonomySearchHitWire[]>(
        `/listings/connections/${connectionId}/taxonomy/categories/search?${params.toString()}`,
      );

      return hits.map((hit) => ({
        category: { ...hit.category, leaf: hit.category.leaf ?? false },
        path: hit.path,
      }));
    },

    getAttributeRules: (connectionId) =>
      request<AttributeRule[]>(`/connections/${connectionId}/attribute-rules`),

    upsertAttributeRule: (connectionId, payload) =>
      request<AttributeRule>(`/connections/${connectionId}/attribute-rules`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),

    deleteAttributeRule: (connectionId, ruleId) =>
      request<void>(`/connections/${connectionId}/attribute-rules/${ruleId}`, {
        method: 'DELETE',
      }),
  };
}
