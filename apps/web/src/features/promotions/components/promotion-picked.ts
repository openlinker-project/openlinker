/**
 * A picker choice as the form's picked product (#3935)
 *
 * @module apps/web/src/features/gifts/components
 */
import type { BundleProductChoice } from '../../bundles';
import type { PickedProduct } from '../lib/gift-rule-form';

export const toPicked = (choice: BundleProductChoice): PickedProduct => ({
  productId: choice.productId,
  variantId: choice.variantId,
  name: choice.name,
});
