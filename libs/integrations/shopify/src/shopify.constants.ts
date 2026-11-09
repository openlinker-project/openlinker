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
] as const;

/**
 * Scopes asked for at install that the integration works without. Missing
 * one is a warning on the connection test, never a refusal: it only switches
 * off the optional ability that needs it.
 *
 * `write_draft_orders` - the tax rate read (`ProductTaxRateReader`, #3975,
 * L-T4): `draftOrderCalculate` computes the rate without creating anything,
 * but Shopify gates it behind this scope. Without it the catalogue syncs and
 * every product's rate stays "not checked", and a store whose prices exclude
 * tax reports no prices (they cannot be stated gross, ADR-077).
 *
 * `read_shipping` - the delivery-profile method names offered as delivery
 * methods in the mapping UI (#3977, C13). Without it only the methods seen on
 * recent orders are listed.
 */
export const SHOPIFY_OPTIONAL_SCOPES = ['write_draft_orders', 'read_shipping'] as const;

/** What each optional scope switches off when it is missing, for the connection test. */
export const SHOPIFY_OPTIONAL_SCOPE_EFFECTS: Readonly<Record<(typeof SHOPIFY_OPTIONAL_SCOPES)[number], string>> = {
  write_draft_orders: 'product tax rates are not read, and a store whose prices exclude tax reports no prices',
  read_shipping: 'delivery methods are offered only as seen on recent orders',
};

/**
 * Quantity reported for an untracked variant when the connection sets no
 * `unmanagedStockQuantity` - the WooCommerce `DEFAULT_UNMANAGED_STOCK_QUANTITY`.
 * Reporting none would zero live offers; refusing would dead-letter a sweep
 * job per such product on every tick (L-I1).
 */
export const SHOPIFY_DEFAULT_UNMANAGED_STOCK_QUANTITY = 1000;

/** Gateway name of Shopify's built-in cash-on-delivery manual method (live, L-O2). */
export const SHOPIFY_COD_GATEWAY = 'Cash on Delivery (COD)';

/** Tag on every order OpenLinker creates in a store, so the merchant can filter them (#3978). */
export const SHOPIFY_ORDER_TAG = 'openlinker';

/** Gateway name of Shopify's built-in bank-deposit manual method. */
export const SHOPIFY_BANK_DEPOSIT_GATEWAY = 'Bank Deposit';
