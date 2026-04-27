/**
 * Category Parameters Reader Capability
 *
 * Optional sub-capability of `OfferManagerPort` — adapters that expose the
 * marketplace's per-category parameter schema (Allegro "required parameters",
 * eBay "Item Specifics", Amazon "Product Type Definitions") declare
 * `implements CategoryParametersReader`. Used by the create-offer wizard
 * (#410) to render dynamic per-category fields.
 *
 * Returns the full parameter set (required + optional). UI decides what to
 * surface and in what order.
 *
 * See `category-browser.capability.ts` for the shared naming convention.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { CategoryParameter } from '../../types/category-parameter.types';
import type { OfferManagerPort } from '../offer-manager.port';

export interface CategoryParametersReader {
  fetchCategoryParameters(input: { categoryId: string }): Promise<CategoryParameter[]>;
}

export function isCategoryParametersReader(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & CategoryParametersReader {
  return typeof (adapter as Partial<CategoryParametersReader>).fetchCategoryParameters === 'function';
}
