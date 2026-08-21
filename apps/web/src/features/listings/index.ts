/**
 * Listings — public surface
 *
 * Public barrel for the listings feature (#609). Cross-feature consumers
 * (today: the `plugins/allegro` wiring, which references the Allegro
 * create-offer wizard and the listings API request type) import from here.
 */
export type { CreateOfferRequest } from './api/listings.types';
export {
  selectPublishDestinations,
  publishDestinationKind,
  PUBLISH_DESTINATION_KIND_HINT,
  PUBLISH_DESTINATION_GROUP_LABEL,
  PUBLISH_DESTINATION_KIND_ORDER,
  MARKETPLACE_PUBLISH_CAPABILITY,
  SHOP_PUBLISH_CAPABILITY,
} from './lib/publish-destinations';
export type {
  PublishDestination,
  PublishDestinationKind,
} from './lib/publish-destinations';
export { PublishDestinationRail } from './components/publish-destination-rail';
export { ErliBulkConfigSection } from './components/erli/erli-bulk-config-section';
export { erliBulkConfigIsComplete } from './components/erli/erli-offer-fields.schema';
export { ErliBulkRowSection } from './components/erli/erli-bulk-row-section';
export { erliOfferValidation } from './components/erli/erli-offer-validation';
export { AllegroBulkConfigSection } from './components/allegro/allegro-bulk-config-section';
export { allegroBulkConfigIsComplete } from './components/allegro/allegro-bulk-config.schema';
export { allegroOfferValidation } from './components/allegro/allegro-offer-validation';
export { WoocommercePublishWizard } from './components/woocommerce-publish-wizard';
// Shop destination category picker (#1834). Self-contained modal + hook so the
// shop edit modal (#1830) can mount it where the marketplace path mounts
// `BulkCategoryChooseModal`, gated on the shop `ShopCategoryBrowser` capability.
export { ShopCategoryPickerModal } from './components/bulk/shop-category-picker-modal';
export { useShopCategoriesQuery } from './hooks/use-shop-categories-query';
export type { ShopCategory } from './api/listings.types';
// Shop destination structured attribute picker (#1835). Self-contained panel +
// hooks so the shop edit modal (#1830) can mount it in its attributes section,
// gated on the shop `ShopAttributeReader` capability. Emits neutral
// `OfferParameter`s (product-section) the caller threads onto publish parameters.
export { ShopAttributePicker } from './components/bulk/shop-attribute-picker';
export { useShopAttributesQuery } from './hooks/use-shop-attributes-query';
export { useDescriptionFormatQuery } from './hooks/use-description-format-query';
export { useShopAttributeTermsQuery } from './hooks/use-shop-attribute-terms-query';
export type { ShopAttribute, ShopAttributeTerm } from './api/listings.types';
// NOTE: `ShopPublishLauncher` is intentionally NOT re-exported here. It
// imports the app-tier `useShopPublishWizard` binding, which imports the
// plugin registry — re-exporting it from this barrel (which the WooCommerce
// plugin consumes for `WoocommercePublishWizard`) would create a module-init
// cycle (registry → woo plugin → listings barrel → launcher → registry). The
// listings page imports the launcher via its direct component path instead.
