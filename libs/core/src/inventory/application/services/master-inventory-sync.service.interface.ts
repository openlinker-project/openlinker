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
  /**
   * True when the product's inventory was found deleted at the master
   * (neutral `MasterProductNotFoundError`) — all its rows were marked stale
   * and no canonical write ran (#1688). The worker handler maps this to a
   * terminal `outcome: 'business_failure'` (ADR-007) instead of a retryable
   * throw.
   */
  masterDeleted: boolean;
  /**
   * True when the staleness prune was SKIPPED because another connection with
   * `InventoryMaster` enabled also claims this internal product id (#1904).
   * Pruning is keyed on the internal product id alone - with two capable
   * claimants it cannot be attributed, so it is withheld rather than staling
   * rows a sibling connection still considers live. Canonical writes still ran;
   * no `master.*.stale` event was emitted.
   */
  pruneSkipped: boolean;
}

export interface IMasterInventorySyncService {
  syncFromMasterByExternalId(
    connectionId: string,
    externalId: string,
  ): Promise<MasterInventorySyncResult>;
}

