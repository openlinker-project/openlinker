/**
 * Shop Attribute Types
 *
 * Neutral shapes returned by `ShopAttributeReader` — a shop's store-wide
 * ("global") product attributes and their predefined terms. Distinct from a
 * free-text custom attribute (which carries only ad-hoc option strings and has
 * no id/term identity): a global attribute is a first-class, reusable taxonomy
 * (WooCommerce `pa_*` attribute + its terms; Shopify a metafield definition,
 * …) that powers storefront filtering, so an operator picks one plus its
 * predefined terms rather than typing free text.
 *
 * Deliberately minimal — `id` (the destination-native attribute id used to link
 * on publish), `name` (operator-facing), and `slug` (the stable taxonomy key).
 * Terms carry the same triple; `id` is the term id threaded back on publish as
 * the neutral `OfferParameter.valuesIds` linkage.
 *
 * @module libs/core/src/listings/domain/types
 * @see {@link ShopAttributeReader} for the capability that returns these.
 */

export interface ShopAttribute {
  /** Destination-native global-attribute id (e.g. a WooCommerce attribute id). */
  id: string;
  /** Human-readable attribute name (e.g. "Color"). */
  name: string;
  /** Stable taxonomy slug (e.g. WooCommerce `pa_color`). */
  slug: string;
}

export interface ShopAttributeTerm {
  /** Destination-native term id, threaded back on publish as `valuesIds`. */
  id: string;
  /** Human-readable term name (e.g. "Red"). */
  name: string;
  /** Stable term slug (e.g. `red`). */
  slug: string;
}
