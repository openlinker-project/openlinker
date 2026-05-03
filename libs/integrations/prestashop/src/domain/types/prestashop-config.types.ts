/**
 * PrestaShop Connection Configuration Types
 *
 * Type definitions for PrestaShop connection configuration. Defines the structure
 * of configuration data stored in Connection.config for PrestaShop integrations.
 *
 * @module libs/integrations/prestashop/src/domain/types
 */

/**
 * Response format preference values
 *
 * Runtime array of all valid `responseFormat` values. Used by the API-layer
 * `PrestashopConnectionConfigDto` (#509) to validate operator input via
 * `@IsIn(ResponseFormatValues as readonly string[])` and as the source of
 * truth for the derived `ResponseFormat` union below.
 */
export const ResponseFormatValues = ['auto', 'json', 'xml'] as const;

/**
 * Response format preference type
 *
 * Derived union from `ResponseFormatValues` — keeps the runtime array and
 * type definition in lockstep without a TypeScript `enum`.
 */
export type ResponseFormat = (typeof ResponseFormatValues)[number];

/**
 * PrestaShop connection configuration
 *
 * Configuration stored in Connection.config for PrestaShop WebService integrations.
 * All fields except baseUrl are optional with sensible defaults.
 */
export interface PrestashopConnectionConfig {
  /**
   * Base URL of the PrestaShop store (required)
   * Example: 'https://shop.example.com'
   */
  baseUrl: string;

  /**
   * Public storefront URL used to build product-image URLs (optional).
   *
   * PrestaShop webservice image endpoints (`/images/products/{id}/{image_id}`)
   * require an API key and cannot be loaded by a browser. Public storefront
   * image paths (`{storefrontBaseUrl}/img/p/…`) are unauthenticated and work
   * for any public PrestaShop storefront.
   *
   * If unset, the adapter factory falls back to `baseUrl` — correct for the
   * common case where the webservice and the storefront share a host.
   * Provide this override only when they differ (e.g. webservice at
   * `api.shop.com`, storefront at `shop.com`).
   *
   * Example: `'https://shop.example.com'` (no trailing slash).
   */
  storefrontBaseUrl?: string;

  /**
   * Shop ID for multi-store PrestaShop installations (optional)
   * Maps to `id_shop` query parameter in PrestaShop API requests
   * If not provided, uses default shop (ID 1)
   */
  shopId?: number;

  /**
   * Preferred language ID for localized fields (optional, default: 1)
   * Used when fetching localized product names, descriptions, etc.
   * This is the primary language that will be used for canonical product fields.
   * If the preferred language is not available, falls back to first non-empty language.
   *
   * @deprecated Use `preferredLanguageId` instead. `langId` is kept for backward compatibility.
   */
  langId?: number;

  /**
   * Preferred language ID for localized fields (optional, default: 1)
   * Used when fetching localized product names, descriptions, etc.
   * This is the primary language that will be used for canonical product fields.
   * If the preferred language is not available, falls back to first non-empty language.
   */
  preferredLanguageId?: number;

  /**
   * Request timeout in milliseconds (optional, default: 30000)
   */
  timeoutMs?: number;

  /**
   * Page size for paginated requests (optional, default: 100)
   */
  pageSize?: number;

  /**
   * Response format preference (optional, default: 'auto')
   * - 'auto': Try JSON first, fallback to XML
   * - 'json': Force JSON (will fail if not supported)
   * - 'xml': Force XML
   */
  responseFormat?: ResponseFormat;

  /**
   * Default ISO 4217 currency code for products synced from this PrestaShop
   * connection (e.g. 'PLN', 'EUR'). When unset, products persist `currency=null`
   * and the FE renders a muted "Currency unknown" fallback.
   *
   * @see {@link Product.currency} in `@openlinker/core`
   */
  currency?: string;

  /**
   * Default PrestaShop carrier ID applied to incoming orders when no
   * connection-level carrier mapping resolves for the source delivery method.
   *
   * Resolution chain at order-create time:
   *   1. Per-method carrier mapping (`MappingConfigService.resolveCarrierMapping`)
   *   2. This `defaultCarrierId`
   *   3. PrestaShop's hardcoded `id_carrier=1` (first carrier)
   *
   * Both fallbacks are logged at `warn` so unmapped methods are observable.
   * Must be a positive integer; `0` and negatives are rejected at config-validation
   * time.
   */
  defaultCarrierId?: number;

  /**
   * Default PrestaShop customer-group ID applied to OL-provisioned guest
   * customers (#505). PS WS validates the order's `id_carrier` against the
   * customer's groups at `POST /orders` time and silently zeros the value
   * if the carrier doesn't accept any of the customer's groups. Without
   * this set explicitly, PS defaults the unspecified field to 0, the
   * customer ends up in group 0 only, and any carrier with group
   * restrictions (the standard configuration) silently rejects the order.
   *
   * Defaults to `2` — PS's stock-fixture "Guest" group, the standard slot
   * for `is_guest=1` customers on a vanilla PS install. Override only when
   * the destination shop has a non-standard group setup (group 2 missing
   * or used for a different role).
   *
   * Must be a positive integer; `0`, negatives, and non-finite values are
   * rejected at provisioning time with a `warn` log and fall back to 2.
   * Mirrors the resolution-chain pattern of `defaultCarrierId` above.
   */
  guestCustomerGroupId?: number;

  /**
   * Additional PrestaShop payment-module names installed on this connection's
   * shop that aren't in the curated `PRESTASHOP_PAYMENT_MODULES` list. Each
   * entry is a module's technical name (matches the `payment` field on
   * PrestaShop orders, e.g. `'custom_module_xyz'`).
   *
   * Resolution at dropdown-render time (see
   * `PrestashopOrderProcessorManagerAdapter.listPaymentMethods`):
   *   1. Curated `PRESTASHOP_PAYMENT_MODULES` list (always included).
   *   2. These overrides, deduped against the curated list and against
   *      themselves so the same name is never rendered twice.
   *
   * Use this when an operator's shop has a payment module that's not common
   * enough to bake into the curated list. Existing saved mappings continue
   * to resolve by exact-string match regardless of whether the module is in
   * the curated list — overrides only affect *adding* new mappings.
   */
  paymentModuleOverrides?: string[];

  /**
   * OL's externally-reachable base URL **from PrestaShop's perspective**.
   * Used by the `openlinker` PS module to POST webhooks back to OL.
   *
   * Per-connection because dev (`host.docker.internal`), multi-network
   * deploys, and reverse-proxy edge cases legitimately differ. The FE
   * pre-fills this from `window.location.origin` on first connection-edit;
   * the operator can override.
   *
   * Required at install time (#168). The `POST /connections/:id/webhooks/
   * install` endpoint returns 400 when unset, with operator-actionable text
   * pointing back to the connection-edit page. Deliberately **not** derived
   * from request headers (Host header injection would let an attacker stuff
   * a malicious URL into the PS module's config during a legitimate operator
   * click).
   */
  openlinkerCallbackBaseUrl?: string;

  /**
   * Whether OL has successfully pushed webhook configuration (Base URL,
   * Connection ID, Webhook Secret) to the PS `openlinker` module via the
   * built-in PS WS `configurations` resource (#168). Set by the install
   * endpoint after the WS push succeeds; cleared by rotate-without-push
   * failures. Operators do not set this manually; the FE renders status from
   * this field plus the most recent `test_ping` webhook delivery.
   */
  webhooksConfigured?: boolean;
}



