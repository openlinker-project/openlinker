/**
 * Bundle Offer Preview Types
 *
 * I/O shapes for `BundleOfferPreviewService` (#3520): how a bundle variant would
 * be published as a product-set offer, computed read-only before the operator
 * submits the bulk wizard.
 *
 * @module libs/core/src/listings/application/types
 */

import type {
  ProductSetComponentMode,
  ProductSetComponentProblem,
} from '../../domain/ports/capabilities/product-set-planner.capability';

/** One bundle variant to preview, under the category the row currently has. */
export interface BundleOfferPreviewItem {
  internalVariantId: string;
  /** The category chosen for the offer, when one is set. */
  categoryId?: string;
}

export interface BundleOfferPreviewInput {
  connectionId: string;
  items: BundleOfferPreviewItem[];
}

export interface BundleOfferPreviewComponent {
  variantId: string;
  productId: string;
  name: string;
  sku: string | null;
  quantity: number;
  giftSlot: boolean;
  imageUrl: string | null;
  mode: ProductSetComponentMode;
  externalOfferId?: string;
  /** Category of the component's product card, when the destination knows it. */
  cardCategoryId?: string;
  problems: ProductSetComponentProblem[];
}

export const BundleOfferPreviewFailureValues = [
  'planning-unsupported',
  'preview-failed',
] as const;
export type BundleOfferPreviewFailure = (typeof BundleOfferPreviewFailureValues)[number];

export type BundleOfferPreviewEntry =
  | {
      internalVariantId: string;
      status: 'ok';
      components: BundleOfferPreviewComponent[];
      /** Category of the FIRST component's card: the destination requires the offer to match it. */
      suggestedCategoryId: string | null;
      /** Whole sets sellable now: the minimum over components of floor(available / quantity). `null` when unknown. */
      availableSets: number | null;
      limitingComponentVariantId: string | null;
    }
  | { internalVariantId: string; status: 'not-a-bundle' }
  | { internalVariantId: string; status: 'failed'; reason: BundleOfferPreviewFailure };

export interface BundleOfferPreviewResult {
  entries: BundleOfferPreviewEntry[];
}
