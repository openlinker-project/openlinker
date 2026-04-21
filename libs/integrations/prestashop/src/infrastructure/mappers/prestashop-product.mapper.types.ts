/**
 * PrestaShop Product Mapper Types
 *
 * Options consumed by `PrestashopProductMapper` at construction time. Kept in
 * a separate file per `docs/engineering-standards.md#type-definitions-in-separate-files`.
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers
 */

/**
 * Construction-time options for `PrestashopProductMapper`.
 *
 * The mapper is instantiated once per connection by
 * `PrestashopAdapterFactory.createAdapters()`, so these options are effectively
 * per-connection configuration frozen at adapter-creation time.
 */
export interface PrestashopProductMapperOptions {
  /**
   * Base URL used to build public product-image URLs.
   *
   * Always a valid URL at runtime — the adapter factory falls back to the
   * connection's webservice `baseUrl` when `storefrontBaseUrl` is unset.
   * Never null. Trailing slashes are tolerated by the mapper.
   */
  storefrontBaseUrl: string;
}
