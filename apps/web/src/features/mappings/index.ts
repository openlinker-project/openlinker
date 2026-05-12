/**
 * Mappings — public surface
 *
 * Public barrel for the mappings feature (#609). Cross-feature consumers
 * (today: `features/listings` for the category picker, `plugins/prestashop`
 * for the fallback carrier picker) import from here.
 */
export type { MappingOption, AllegroCategory } from './api/mappings.types';
export { useAllegroCategoriesQuery } from './hooks/use-allegro-categories';
export { useMappingOptions } from './hooks/use-mapping-options';
