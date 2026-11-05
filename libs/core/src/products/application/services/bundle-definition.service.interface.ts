/**
 * Bundle Definition Service Interface (#3607)
 *
 * @module libs/core/src/products/application/services
 */
import type {
  BundleDefinition,
  BundleDefinitionVersion,
  MultipackConfirmation,
  BundleGiftDocumentForm,
} from '../../domain/types/bundle.types';

export interface BundleComponentInput {
  variantId: string;
  quantity: number;
  giftSlot?: boolean;
  /** How a document shows the gift slot; ignored unless `giftSlot` (#3940). */
  documentForm?: BundleGiftDocumentForm;
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

  /**
   * The current definitions whose components include ANY of `variantIds` - the
   * reverse lookup a component change or cancellation uses to republish the
   * bundles it feeds (#3931). Nesting is refused, so a bundle never appears
   * as a component and the lookup cannot recurse.
   */
  findCurrentContainingComponents(variantIds: readonly string[]): Promise<BundleDefinition[]>;

  /** Which of the given (variant, pack quantity) pairs an operator has confirmed (#3624). */
  findConfirmedMultipacks(
    pairs: readonly MultipackConfirmation[]
  ): Promise<MultipackConfirmation[]>;

  /**
   * Confirm that one sale of `variantId` at pack quantity N means N units of it
   * (#3624). Creates no product. Idempotent.
   */
  confirmMultipack(confirmation: MultipackConfirmation, confirmedByUserId: string | null): Promise<void>;

  /** Version history of one variant, oldest first. */
  history(variantId: string): Promise<BundleDefinitionVersion[]>;
}
