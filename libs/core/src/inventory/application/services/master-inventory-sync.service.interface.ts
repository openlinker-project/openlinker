/**
 * Master Inventory Sync Service Interface
 *
 * Core-owned orchestration for pulling inventory state from a master system
 * (e.g., PrestaShop) via InventoryMasterPort and upserting into canonical storage.
 *
 * @module libs/core/src/inventory/application/services
 */

export interface MasterInventorySyncResult {
  internalProductId: string;
  /** Number of canonical inventory rows written — one per variant/combination (#823). */
  itemsWritten: number;
  /** Total available quantity summed across all written rows. */
  availableQuantity: number;
  /** Total reserved quantity summed across all written rows. */
  reservedQuantity: number;
}

export interface IMasterInventorySyncService {
  syncFromMasterByExternalId(
    connectionId: string,
    externalId: string,
  ): Promise<MasterInventorySyncResult>;
}

