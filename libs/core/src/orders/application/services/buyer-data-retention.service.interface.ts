/**
 * Buyer Data Retention Service Interface (#4289)
 *
 * @module libs/core/src/orders/application/services
 */
import type {
  BuyerDataRetentionPreview,
  BuyerDataRetentionPreviewInput,
  BuyerDataRetentionRunResult,
} from '../../domain/types/buyer-data-retention.types';

export interface IBuyerDataRetentionService {
  /**
   * The trial run: how many orders the given rule would hide and erase, and a
   * few masked examples. Reads only - writes nothing and carries no personal
   * data in its answer.
   */
  preview(input: BuyerDataRetentionPreviewInput): Promise<BuyerDataRetentionPreview>;

  /**
   * One bounded sweep over every connection: resolve each connection's
   * effective rule (its own override over the global default), then hide and
   * erase what is due. A connection whose effective rule is off is skipped.
   * Never throws for one connection's failure; it is logged and the next
   * connection proceeds.
   */
  runOnce(now?: Date): Promise<BuyerDataRetentionRunResult>;
}
