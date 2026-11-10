/**
 * Bundle Offer Preview Service Interface
 *
 * @module libs/core/src/listings/application/interfaces
 */
import type {
  BundleOfferPreviewInput,
  BundleOfferPreviewResult,
} from '../types/bundle-offer-preview.types';

export interface IBundleOfferPreviewService {
  /**
   * How each bundle variant would be published as a product-set offer, without
   * creating anything. One entry per input item, in input order; a variant that
   * is not a bundle reports `not-a-bundle`, and a failure is its own state.
   */
  preview(input: BundleOfferPreviewInput): Promise<BundleOfferPreviewResult>;
}
