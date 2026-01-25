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
  availableQuantity: number;
  reservedQuantity: number;
}

export interface IMasterInventorySyncService {
  syncFromMasterByExternalId(
    connectionId: string,
    externalId: string,
  ): Promise<MasterInventorySyncResult>;
}

