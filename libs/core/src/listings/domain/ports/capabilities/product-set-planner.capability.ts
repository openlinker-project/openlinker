/**
 * Product Set Planner Capability
 *
 * Optional sub-capability of `OfferManagerPort` (#3520). A destination that can
 * publish one offer made of several products (a bundle) declares how it would
 * build each component, without creating anything: the wizard asks this before
 * the operator submits, so a component that cannot be listed is named on the
 * Review step instead of rejected by the marketplace afterwards.
 *
 * Read-only by contract: an implementation may read the marketplace but must not
 * create, update or upload. Marketplace-neutral: no platform vocabulary here.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { OfferProductSetComponent } from '../../types/offer-create.types';
import type { OfferManagerPort } from '../offer-manager.port';

/** How a component enters the set offer. */
export const ProductSetComponentModeValues = [
  'own-offer',
  'catalog-card',
  'new-product',
  'missing',
] as const;
export type ProductSetComponentMode = (typeof ProductSetComponentModeValues)[number];

export interface ProductSetPlanRequest {
  /** Destination category the set offer would be created in, when known. */
  categoryId?: string;
  components: readonly OfferProductSetComponent[];
}

export interface ProductSetComponentProblem {
  code: string;
  message: string;
}

export interface ProductSetComponentPlan {
  variantId: string;
  mode: ProductSetComponentMode;
  /** Set when the component is linked from its own live offer. */
  externalOfferId?: string;
  /** Category of the component's product card, when the destination knows it. */
  cardCategoryId?: string;
  problems: ProductSetComponentProblem[];
}

export interface ProductSetPlanner {
  previewProductSet(request: ProductSetPlanRequest): Promise<ProductSetComponentPlan[]>;
}

export function isProductSetPlanner(adapter: OfferManagerPort): adapter is OfferManagerPort & ProductSetPlanner {
  return typeof (adapter as Partial<ProductSetPlanner>).previewProductSet === 'function';
}
