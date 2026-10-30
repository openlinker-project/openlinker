/**
 * Inventory Correction Service Interface (#3566)
 *
 * The operator's manual stock correction, written to the product master that owns
 * the variant's stock and mirrored back so marketplaces follow.
 *
 * @module libs/core/src/inventory/application/services
 */
import type {
  CorrectStockInput,
  InventoryCorrectionResult,
  InventoryCorrectionTarget,
} from '../../domain/types/inventory-correction.types';

export interface IInventoryCorrectionService {
  /**
   * Which product master a correction would write to, and the current mirrored
   * stock. Read-only: builds no adapter and writes nothing.
   *
   * @throws InventoryCorrectionVariantNotFoundError when the variant is unknown
   */
  getCorrectionTarget(input: { productVariantId: string }): Promise<InventoryCorrectionTarget>;

  /**
   * Correct a variant's stock. Pre-boundary refusals THROW (nothing written); an
   * outcome after the boundary - applied, refused by the master, in doubt - is
   * RETURNED, because the act is recorded in the ledger.
   */
  correctStock(input: CorrectStockInput): Promise<InventoryCorrectionResult>;
}
