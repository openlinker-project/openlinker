/**
 * Shopify Admin GraphQL Response Types
 *
 * The slices of the Admin GraphQL schema (API 2026-10) the plugin selects.
 * Only fields a query actually asks for are declared, and every one Shopify
 * may omit or null is typed so.
 *
 * @module libs/integrations/shopify/src/domain/types
 */

export interface ShopifyGraphqlErrorEntry {
  readonly message: string;
  readonly extensions?: { readonly code?: string } | null;
}

export interface ShopifyThrottleStatus {
  readonly maximumAvailable: number;
  readonly currentlyAvailable: number;
  readonly restoreRate: number;
}

export interface ShopifyGraphqlEnvelope<T> {
  readonly data?: T | null;
  readonly errors?: readonly ShopifyGraphqlErrorEntry[];
  readonly extensions?: {
    readonly cost?: {
      readonly requestedQueryCost?: number;
      readonly throttleStatus?: ShopifyThrottleStatus;
    };
  };
}

export interface ShopifyPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

export interface ShopifyConnection<T> {
  readonly nodes: readonly T[];
  readonly pageInfo?: ShopifyPageInfo;
}

export interface ShopifyShopInfo {
  readonly id: string;
  readonly name: string;
  readonly myshopifyDomain: string;
  readonly currencyCode: string;
  readonly taxesIncluded: boolean;
}

export interface ShopifyLocationNode {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
}
