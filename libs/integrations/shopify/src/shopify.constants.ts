/**
 * Shopify Constants
 *
 * Identity of the Shopify plugin and the facts about the Admin GraphQL API
 * that more than one file needs, kept in one place so the manifest, the
 * tester, the OAuth adapter and the validators cannot drift apart.
 *
 * @module libs/integrations/shopify/src
 */
import type { AdapterMetadata } from '@openlinker/core/integrations';

export const SHOPIFY_ADAPTER_KEY = 'shopify.admin.v1';
export const SHOPIFY_PLATFORM_TYPE = 'shopify';
export const SHOPIFY_BRAND = 'Shopify';

/**
 * Admin API versions the plugin's queries are verified against. A version is
 * added here only after the queries were checked against its reference;
 * Shopify keeps a version for twelve months, so an older one can be dropped
 * once it is no longer served.
 */
export const SHOPIFY_SUPPORTED_API_VERSIONS = ['2026-10'] as const;
export type ShopifyApiVersion = (typeof SHOPIFY_SUPPORTED_API_VERSIONS)[number];

/** API version used when the connection names none. */
export const SHOPIFY_DEFAULT_API_VERSION: ShopifyApiVersion = '2026-10';

/**
 * Request-count guard through the shared limiter. Shopify meters GraphQL by
 * query COST (a leaky bucket per app and store, 20000 points / 1000 per s on
 * the spike's dev store, L-C2), which the GraphQL client paces from the
 * `throttleStatus` it reads back; this cap only keeps the request rate far
 * below any plan's restore rate.
 */
export const SHOPIFY_DEFAULT_RATE_LIMIT: NonNullable<AdapterMetadata['defaultRateLimit']> = {
  requestsPerMinute: 240,
  maxConcurrent: 4,
};

/**
 * Admin API scopes the planned capabilities use. Requested on an OAuth
 * install and checked by the connection tester, because Shopify refuses a
 * field the token has no scope for (`ACCESS_DENIED`) only on the first job
 * that needs it.
 */
export const SHOPIFY_REQUIRED_SCOPES = [
  'read_products',
  'write_products',
  'read_inventory',
  'write_inventory',
  'read_locations',
  'read_orders',
  'write_orders',
  'read_returns',
  'write_returns',
  'read_merchant_managed_fulfillment_orders',
  'write_merchant_managed_fulfillment_orders',
  // Publishing a product makes it visible on a sales channel
  // (`publishablePublish`); without it a published product stays unlisted on
  // the Online Store.
  'read_publications',
  'write_publications',
  // ProductTaxRateReader (#3975, L-T4): `draftOrderCalculate` computes the
  // rate without creating anything, but Shopify gates it behind this scope.
  'write_draft_orders',
] as const;
