/**
 * Mappings — public surface
 *
 * Public barrel for the mappings feature (#609). Cross-feature consumers
 * (today: `features/listings` for the category picker, `plugins/prestashop`
 * for the fallback carrier picker) import from here.
 */
export type { MappingOption, AllegroCategory, CategoryPathNode } from './api/mappings.types';
export type { RoutingRule, FulfillmentProcessorKind } from './api/mappings.types';
export { useAllegroCategoriesQuery } from './hooks/use-allegro-categories';
export { useCategoryPathQuery } from './hooks/use-category-path';
export { useMappingOptions } from './hooks/use-mapping-options';
// Consumed by the orders generate-label flow to predict the routed carrier
// (#1569 — scope the COD currency to the carrier a delivery method routes to).
export { useRoutingRulesQuery } from './hooks/use-routing-rules';
// Delivery-mapping fix-it deep link (#1794) — built by the orders delivery
// rider, parsed by the connection-mappings page.
export {
  DELIVERY_MAPPING_DEEP_LINK_PARAMS,
  DELIVERY_MAPPING_TAB,
  buildDeliveryMappingLink,
  type DeliveryMappingLinkInput,
} from './lib/delivery-mapping-deep-link';
