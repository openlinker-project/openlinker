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

  /**
   * Default ISO 4217 currency code assigned to every product produced by the
   * mapper (e.g. `'PLN'`, `'EUR'`). When undefined, the mapper emits
   * `currency: null` and downstream persistence treats currency as unknown.
   */
  currency?: string;

  /**
   * PrestaShop image-variant suffix used when constructing public storefront
   * image URLs (`/img/p/{split}/{imageId}-{variant}.jpg`).
   *
   * Defaults to `'large_default'` (~800px on a stock PS install) so images
   * pass Allegro's `productSet[0].product.images[]` validator, which rejects
   * anything whose longer side is < 400px with `TOO_SMALL_IMAGE` (#424).
   * The previous `'home_default'` thumbnail (~250px) reliably tripped that
   * gate.
   *
   * Override per connection if the PS instance uses a non-standard variant
   * name or has resized `large_default` below 400px in the back-office.
   */
  imageVariant?: string;
}
