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
  /**
   * True when the product was found deleted at the master (neutral
   * `MasterProductNotFoundError`) — all its variants were marked stale and no
   * upsert ran (#1599). The worker handler maps this to a terminal
   * `outcome: 'business_failure'` (ADR-007) instead of a retryable throw.
   */
  masterDeleted: boolean;
}

export interface IMasterProductSyncService {
  syncFromMasterByExternalId(
    connectionId: string,
    externalId: string,
  ): Promise<MasterProductSyncResult>;
}

