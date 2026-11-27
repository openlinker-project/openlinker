/**
 * Bundle Master Sync Service Interface (#3932)
 *
 * @module libs/core/src/products/application/services
 */
import type { BundleDefinition } from '../../domain/types/bundle.types';

export interface MasterBundleComponentPreview {
  variantId: string;
  productId: string;
  quantity: number;
}

export interface MasterBundleComposition {
  connectionId: string;
  components: MasterBundleComponentPreview[];
}

export interface BundleReadingMaster {
  connectionId: string;
  connectionName: string;
}

export interface IBundleMasterSyncService {
  /**
   * The variant's master connection when it can read bundle compositions at all,
   * else `null`. Adapter-level only: it does not say the product IS a bundle there.
   */
  findBundleReadingMaster(variantId: string): Promise<BundleReadingMaster | null>;

  /**
   * What the master currently says, without writing anything. Throws
   * `BundleMasterSyncRefusedError` with a named reason when it cannot answer.
   */
  previewComposition(variantId: string): Promise<MasterBundleComposition>;

  /**
   * Write what the master says as a NEW definition version (first definition when
   * the variant had none). Runs only on an explicit call, never on a schedule, and
   * never edits an existing version: open orders keep theirs.
   */
  syncFromMaster(variantId: string): Promise<BundleDefinition>;
}
