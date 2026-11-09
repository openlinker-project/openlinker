/**
 * Mappings — public surface
 *
 * Public barrel for the mappings feature (#609). Cross-feature consumers
 * (today: `features/listings` for the category picker, `plugins/prestashop`
 * for the fallback carrier picker) import from here.
 */
export type { MappingOption, AllegroCategory, CategoryPathNode } from './api/mappings.types';
export type {
  RoutingRule,
  FulfillmentProcessorKind,
  ParcelProfileFields,
} from './api/mappings.types';
export { useAllegroCategoriesQuery } from './hooks/use-allegro-categories';
// Whole-tree category search (#2075). Consumed by both bulk pickers in
// `features/listings` and by this feature's own mapping-authoring picker.
export type { CategorySearchHit } from './api/mappings.types';
export {
  useCategorySearchQuery,
  isSearchableCategoryQuery,
  CATEGORY_SEARCH_MIN_QUERY_LENGTH,
} from './hooks/use-category-search';
export { toCategorySearchResultHits, isTaxonomyUnsynced } from './lib/category-search-hits';
export { useCategoryPathQuery } from './hooks/use-category-path';
export { useMappingOptions } from './hooks/use-mapping-options';
// Consumed by the orders generate-label flow to predict the routed carrier
// (#1569 — scope the COD currency to the carrier a delivery method routes to).
export {
  useRoutingRulesQuery,
  useRoutingRulesForConnections,
} from './hooks/use-routing-rules';
export { hasParcelProfile, summarizeParcelProfile } from './lib/parcel-profile';
// The OMS setup's Shipping step (#3958) edits routing and the label defaults
// with these same components and rules, so there is one editor for each.
export { FulfillmentRoutingSection } from './components/fulfillment-routing-section';
export { ParcelProfileForm } from './components/parcel-profile-form';
export { RoutingDialog } from './components/routing-dialog';
export { RoutingSplitBar, type RoutingSplitBucket } from './components/routing-split-bar';
export {
  routeBuysLabel,
  shippingRouteCopyIn,
  type ShippingRouteCopy,
} from './lib/shipping-route';
export { useShippingRouteCopy } from './hooks/use-shipping-route-copy';
export {
  EMPTY_PARCEL_DRAFT,
  draftFromFields,
  draftToFields,
  isListedParcelTemplate,
  validateDraft,
  type ParcelProfileDraft,
} from './lib/parcel-profile';
// Delivery-mapping fix-it deep link (#1794) — built by the orders delivery
// rider, parsed by the connection-mappings page.
// Second cross-feature consumer as of #2028 (the listings channel pill), so the
// resolver joins the barrel rather than being reached for by deep path. #2088
// made it the app's ONLY platform-label path (14 call sites), which is why the
// no-fallback variant is exported too — see `lib/platform-label.ts`.
export {
  findPlatformDisplayName,
  resolvePlatformLabel,
  resolvePlatformShortLabel,
} from './lib/platform-label';
export {
  DELIVERY_MAPPING_DEEP_LINK_PARAMS,
  DELIVERY_MAPPING_TAB,
  buildDeliveryMappingLink,
  type DeliveryMappingLinkInput,
} from './lib/delivery-mapping-deep-link';
