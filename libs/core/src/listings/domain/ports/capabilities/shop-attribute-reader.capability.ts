/**
 * Shop Attribute Reader Capability
 *
 * Optional sub-capability of `ShopProductManagerPort` — shop adapters that can
 * enumerate the destination's store-wide ("global") product attributes and
 * their predefined terms declare `implements ShopAttributeReader`. Call sites
 * resolve the shop-listing adapter via
 * `getCapabilityAdapter<ShopProductManagerPort>(connectionId, 'ProductPublisher')`
 * and narrow with `isShopAttributeReader(adapter)` before invoking; after the
 * guard TypeScript knows the methods are present.
 *
 * Complements the free-text custom-attribute path: today a shop publish emits
 * every neutral parameter as a per-product custom attribute (`{name, options}`),
 * which cannot power storefront filtering. Reading real global attributes + terms
 * lets an operator pick a structured attribute with predefined values, which the
 * adapter then links on publish (WooCommerce `pa_*` taxonomy + term ids). Custom
 * free-text remains the fallback for one-off attributes (#1835).
 *
 * Advertised-without-dispatch (ADR-002 / architecture-overview §10): declared in
 * the adapter manifest `supportedCapabilities` purely so host-side discovery can
 * tell it apart, and resolved only by narrowing the dispatched `ProductPublisher`
 * adapter with this guard — never via `getCapabilityAdapter(id, 'ShopAttributeReader')`.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 * @see {@link ShopCategoryBrowser} for the sibling read (category-browse) capability.
 */

import type { ShopAttribute, ShopAttributeTerm } from '../../types/shop-attribute.types';
import type { ShopProductManagerPort } from '../shop-product-manager.port';

export interface ShopAttributeReader {
  /**
   * List the destination's store-wide global product attributes (the reusable
   * taxonomy an operator picks from). Pages through the destination's directory
   * internally and returns the full set.
   */
  listAttributes(): Promise<ShopAttribute[]>;

  /**
   * List the predefined terms of one global attribute, identified by its
   * destination-native `attributeId`. Pages internally and returns the full set.
   */
  listAttributeTerms(attributeId: string): Promise<ShopAttributeTerm[]>;
}

export function isShopAttributeReader(
  adapter: ShopProductManagerPort,
): adapter is ShopProductManagerPort & ShopAttributeReader {
  const candidate = adapter as Partial<ShopAttributeReader>;
  return (
    typeof candidate.listAttributes === 'function' &&
    typeof candidate.listAttributeTerms === 'function'
  );
}
