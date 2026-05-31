/**
 * PrestaShop variant-id coercion
 *
 * Resolves an OpenLinker external variant id (as stored in `identifier_mappings`,
 * looked up per connection) to a PrestaShop `id_product_attribute`. Simple
 * products carry a synthetic-variant marker (`product:<n>`) rather than a numeric
 * combination id; PrestaShop validates `id_product_attribute` as an unsigned int,
 * so any non-numeric / missing value must collapse to 0 ("no combination").
 *
 * Shared by the order/cart mapper (`mapOrderCreate` / `mapCartCreate`) and the
 * price-pinning path (`pinLinePrices`) so the coercion cannot drift between the
 * cart/order body and the cart-scoped `specific_prices` rows (#923). Before this
 * was extracted, the mapper coerced but `pinLinePrices` forwarded the raw
 * `product:<n>` marker, which PrestaShop 400-rejected for every simple product.
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers
 * @see allocate-by-largest-remainder for the pure-helper file precedent
 */
export function toPrestashopProductAttributeId(raw: string | number | undefined): number {
  if (raw === undefined) {
    return 0;
  }
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
  return Number.isNaN(parsed) ? 0 : parsed;
}
