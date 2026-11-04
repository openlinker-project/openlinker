/**
 * Shopify Constants
 *
 * Identity of the Shopify plugin and the facts about the Admin GraphQL API that
 * more than one file needs, kept in one place so the manifest, the tester and
 * the validators cannot drift apart.
 *
 * PROTOTYPE (#3928): this package exists to run the spike's end-to-end
 * scenarios against a dev store and is not meant to be merged.
 *
 * @module libs/integrations/shopify/src
 */
import type { AdapterMetadata } from '@openlinker/core/integrations';

export const SHOPIFY_ADAPTER_KEY = 'shopify.admin.v1';
export const SHOPIFY_PLATFORM_TYPE = 'shopify';
export const SHOPIFY_BRAND = 'Shopify';

/** API version used when the connection names none (the version the spike verified live). */
export const SHOPIFY_DEFAULT_API_VERSION = '2026-10';

/**
 * Outbound pacing. Shopify meters GraphQL by query COST (a leaky bucket read
 * from `extensions.cost.throttleStatus`, 20000 / 1000 per s on the dev store,
 * L-C2), not by request count, so a requests-per-minute cap is only a coarse
 * guard. 240/min keeps a prototype far below any plan's restore rate, while
 * the cost-based `THROTTLED` answer is handled by the client and the retry
 * classifier.
 */
export const SHOPIFY_DEFAULT_RATE_LIMIT: NonNullable<AdapterMetadata['defaultRateLimit']> = {
  requestsPerMinute: 240,
  maxConcurrent: 4,
};

/**
 * Admin API scopes the capabilities use. The connection tester reports any of
 * these the app installation was not granted, because Shopify refuses a field
 * the token has no scope for (`ACCESS_DENIED`) only on the first job that
 * needs it.
 */
export const SHOPIFY_REQUIRED_SCOPES = [
  'read_products',
  'read_inventory',
  'write_inventory',
  'read_locations',
  'read_orders',
  'write_orders',
  // The return feed and the return read (ReturnSourceReader).
  'read_returns',
  'read_merchant_managed_fulfillment_orders',
  'write_merchant_managed_fulfillment_orders',
] as const;

/** Gateway name of Shopify's built-in cash-on-delivery manual method (live, L-O2). */
export const SHOPIFY_COD_GATEWAY = 'Cash on Delivery (COD)';

/** Gateway name of Shopify's built-in bank-deposit manual method. */
export const SHOPIFY_BANK_DEPOSIT_GATEWAY = 'Bank Deposit';
