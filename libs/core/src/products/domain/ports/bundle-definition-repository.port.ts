/**
 * Bundle Definition Repository Port (#3607)
 *
 * Persistence contract for versioned bundle compositions.
 *
 * @module libs/core/src/products/domain/ports
 */
import type {
  BundleDefinition,
  BundleDefinitionVersion,
  MultipackConfirmation,
} from '../types/bundle.types';

export interface BundleDefinitionRepositoryPort {
  /** The latest version of each variant's definition, retired ones excluded. */
  findCurrentByVariantIds(variantIds: readonly string[]): Promise<BundleDefinition[]>;

  /** The current definitions that list `variantId` as a component. */
  findCurrentContainingComponent(variantId: string): Promise<BundleDefinition[]>;

  /** The current definitions that list ANY of `variantIds` as a component (one query). */
  findCurrentContainingAnyComponent(variantIds: readonly string[]): Promise<BundleDefinition[]>;

  /** Every version of a variant's definition, oldest first (retired included). */
  findHistory(variantId: string): Promise<BundleDefinitionVersion[]>;

  /** Every current definition, for the list read. */
  listCurrent(): Promise<BundleDefinition[]>;

  /**
   * Insert version `max + 1` (1 for a variant with no history) and return it.
   * The unique `(variantId, version)` index is the concurrency guard.
   */
  insertNextVersion(
    variantId: string,
    components: BundleDefinition['components']
  ): Promise<BundleDefinition>;

  /** Which of the given (variant, pack quantity) pairs an operator has confirmed. */
  findConfirmedMultipacks(
    pairs: readonly MultipackConfirmation[]
  ): Promise<MultipackConfirmation[]>;

  /** Record a confirmation. Idempotent: an existing one is left as it is. */
  confirmMultipack(
    confirmation: MultipackConfirmation,
    confirmedByUserId: string | null
  ): Promise<void>;

  /** Mark every version of the variant retired. Returns whether any row was live. */
  retire(variantId: string): Promise<boolean>;
}
