/**
 * PrestaShop Connection Configuration Types
 *
 * Type definitions for PrestaShop connection configuration. Defines the structure
 * of configuration data stored in Connection.config for PrestaShop integrations.
 *
 * @module libs/integrations/prestashop/src/domain/types
 */

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
  responseFormat?: 'auto' | 'json' | 'xml';

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
}



