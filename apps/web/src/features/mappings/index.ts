/**
 * Mappings — public surface
 *
 * Public barrel for the mappings feature (#609). Cross-feature consumers
 * (today: `features/listings` for the category picker, `plugins/prestashop`
 * for the fallback carrier picker) import from here.
 */
export type { MappingOption, AllegroCategory } from './api/mappings.types';
export type { RoutingRule, FulfillmentProcessorKind } from './api/mappings.types';
export { useAllegroCategoriesQuery } from './hooks/use-allegro-categories';
export { useMappingOptions } from './hooks/use-mapping-options';
// Consumed by the orders generate-label flow to predict the routed carrier
// (#1569 — scope the COD currency to the carrier a delivery method routes to).
export { useRoutingRulesQuery } from './hooks/use-routing-rules';
