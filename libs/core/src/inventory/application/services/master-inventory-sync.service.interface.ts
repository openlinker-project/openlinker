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
  /**
   * Rows this sync soft-staled because the SAME source started reporting the
   * variant at a location while a pooled (`locationId IS NULL`) row of its own
   * was still live — ADR-058 decision (2) enforcement (#2322).
   *
   * **Optional**, so the addition is additive in fact and not merely in name:
   * the worker handler reads none of it, but the handler spec's typed result
   * factory builds this shape by hand and a required field would be churn a
   * repair slice has no business creating.
   *
   * A non-zero value means available stock DROPPED for those variants with no
   * propagation enqueued behind it — the destination write-back gap #2324
   * closes. Emits no `master.*.stale` event: re-locating is not a deletion.
   */
  pooledPositionsStaled?: number;
}

/** One product the batch could not sync, and why (#2648). */
export interface MasterInventoryBatchSyncFailure {
  externalId: string;
  message: string;
}

/**
 * Outcome of one batched page (#2648, mirroring #2593's product side).
 *
 * `failures` is reported rather than thrown because the caller has a better
 * answer than a whole-page retry: re-enqueue the failed ids as ordinary
 * per-product jobs, which keeps their own retry ladder and their own dead row.
 * Failing the batch would let one poisonous product take its ninety-nine
 * page-mates down with it, which the per-product fan-out never did.
 */
export interface MasterInventoryBatchSyncResult {
  results: readonly MasterInventorySyncResult[];
  failures: readonly MasterInventoryBatchSyncFailure[];
  /** True when the master's bulk-read rung answered, so the page was warmed. */
  prefetched: boolean;
}

export interface IMasterInventorySyncService {
  syncFromMasterByExternalId(
    connectionId: string,
    externalId: string,
  ): Promise<MasterInventorySyncResult>;

  /**
   * Sync a page of products' inventory through ONE adapter instance (#2648,
   * ADR-048).
   *
   * Behaviourally identical to calling `syncFromMasterByExternalId` once per
   * id - same variant-keyed writes (#822/#823), same identifier mappings, same
   * #1904 rival-claimant prune guard, same #1688 deletion signal. The only
   * difference is request count: the ids share one adapter instance, so a
   * master declaring `BulkInventoryReader` can read the whole page's stock
   * before the loop starts and every per-product read is served from that one
   * answer.
   *
   * A master declaring nothing is not penalised - the loop runs exactly as the
   * per-product jobs did.
   */
  syncFromMasterByExternalIds(
    connectionId: string,
    externalIds: readonly string[],
  ): Promise<MasterInventoryBatchSyncResult>;
}

