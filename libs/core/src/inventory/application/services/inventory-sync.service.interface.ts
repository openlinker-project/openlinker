/**
 * Inventory Sync Service Interface
 *
 * Core-owned orchestration for propagating inventory state to marketplaces
 * (offer quantity updates).
 *
 * @module libs/core/src/inventory/application/services
 */

import type {
  UpdateOfferQuantityCommand,
  UpdateOfferQuantitiesBatchCommand,
  UpdateOfferQuantitiesBatchResult,
} from '@openlinker/core/listings';

export interface IInventorySyncService {
  updateOfferQuantity(
    connectionId: string,
    cmd: UpdateOfferQuantityCommand
  ): Promise<UpdateOfferQuantitiesBatchResult>;

  updateOfferQuantities(
    connectionId: string,
    cmd: UpdateOfferQuantitiesBatchCommand
  ): Promise<UpdateOfferQuantitiesBatchResult>;
}
