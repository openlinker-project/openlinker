/**
 * Bundle Definition Service Interface (#3607)
 *
 * @module libs/core/src/products/application/services
 */
import type { BundleDefinition } from '../../domain/types/bundle.types';

export interface BundleComponentInput {
  variantId: string;
  quantity: number;
  giftSlot?: boolean;
}

export interface IBundleDefinitionService {
  /** Define a bundle that has no current definition. Refuses nesting both ways. */
  create(variantId: string, components: BundleComponentInput[]): Promise<BundleDefinition>;

  /** Write the next version of an existing definition. */
  update(variantId: string, components: BundleComponentInput[]): Promise<BundleDefinition>;

  /** Retire the definition (history is kept). Open orders keep their frozen expansion. */
  delete(variantId: string): Promise<void>;

  /** The current definition, or `null` when the variant is not a bundle. */
  get(variantId: string): Promise<BundleDefinition | null>;

  /** Every current definition. */
  list(): Promise<BundleDefinition[]>;

  /** Current definitions for several variants; variants that are not bundles are absent. */
  findCurrentByVariantIds(variantIds: readonly string[]): Promise<BundleDefinition[]>;

  /** Version history of one variant, oldest first. */
  history(variantId: string): Promise<BundleDefinition[]>;
}
