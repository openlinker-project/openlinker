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
   * Shop ID for multi-store PrestaShop installations (optional)
   * Maps to `id_shop` query parameter in PrestaShop API requests
   * If not provided, uses default shop (ID 1)
   */
  shopId?: number;

  /**
   * Language ID for localized fields (optional, default: 1)
   * Used when fetching localized product names, descriptions, etc.
   */
  langId?: number;

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
}

