/**
 * Master Product Sync Service Interface
 *
 * Core-owned orchestration for pulling product data from a master system (e.g., PrestaShop)
 * via ProductMasterPort and upserting into canonical storage.
 *
 * @module libs/core/src/products/application/services
 */

export interface MasterProductSyncResult {
  internalProductId: string;
  variantsUpserted: number;
}

export interface IMasterProductSyncService {
  syncFromMasterByExternalId(
    connectionId: string,
    externalId: string,
  ): Promise<MasterProductSyncResult>;
}

