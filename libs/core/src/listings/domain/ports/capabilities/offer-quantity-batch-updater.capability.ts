/**
 * Offer Quantity Batch Updater Capability
 *
 * Optional sub-capability of `OfferManagerPort` — adapters that expose a bulk
 * quantity-update API declare `implements OfferQuantityBatchUpdater`. Core
 * orchestration falls back to per-offer `updateOfferQuantity` when not supported.
 *
 * See `offer-lister.capability.ts` for the shared naming convention.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type {
  UpdateOfferQuantitiesBatchCommand,
  UpdateOfferQuantitiesBatchResult,
} from '../../types/offer-quantity-update.types';
import type { OfferManagerPort } from '../offer-manager.port';

export interface OfferQuantityBatchUpdater {
  updateOfferQuantitiesBatch(
    cmd: UpdateOfferQuantitiesBatchCommand,
  ): Promise<UpdateOfferQuantitiesBatchResult>;
}

export function isOfferQuantityBatchUpdater(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & OfferQuantityBatchUpdater {
  return (
    typeof (adapter as Partial<OfferQuantityBatchUpdater>).updateOfferQuantitiesBatch ===
    'function'
  );
}
