/**
 * Catalog Replication Trust Types
 *
 * The per-connection catalog-trust read model (#2258, ADR-048 decision 2's
 * operator-facing half): which capability rung a ProductMaster is on, whether
 * the opt-in delta pass is actually enabled, and when deletion reconciliation
 * last completed a cycle.
 *
 * @module domain/types
 */

/**
 * The capability rung a ProductMaster connection's adapter declares
 * (ADR-048 decision 1), in capability terms — never `platformType`.
 *
 * - `'modified-since'` — the dispatched adapter declares `ModifiedProductLister`
 *   (a guard-only sub-capability: absent from every manifest and from
 *   `CoreCapabilityValues`, resolved by narrowing the dispatched adapter).
 * - `'full-enumeration'` — the base rung: the adapter can only enumerate its
 *   whole catalog, so every scheduled sync re-reads everything. This is a
 *   correct, declared state (e.g. PrestaShop, #2221) — not a degradation.
 * - `'unknown'` — the adapter could not be resolved (disabled connection,
 *   credential failure). A distinct value because asserting either real rung
 *   for an adapter that did not answer would be a false claim.
 */
export const MasterCatalogRungValues = ['modified-since', 'full-enumeration', 'unknown'] as const;
export type MasterCatalogRung = (typeof MasterCatalogRungValues)[number];

/**
 * One `ProductMaster`-capable connection's catalog-trust facts.
 */
export interface ConnectionCatalogTrust {
  connectionId: string;

  /** The declared capability rung — see {@link MasterCatalogRungValues}. */
  rung: MasterCatalogRung;

  /**
   * Whether the deployment-wide delta scheduler task
   * (`master.product.syncDelta`, opt-in via
   * `OL_MASTER_PRODUCT_DELTA_SYNC_ENABLED`) is currently enabled. A
   * `'modified-since'` rung with this false means the connection still
   * full-enumerates in practice — the "declared but dormant" state an
   * operator would otherwise misread as incremental sync being live.
   */
  deltaPassEnabled: boolean;

  /**
   * When the deletion-reconciliation pass (`master.product.reconcile`,
   * #2242) last COMPLETED a cycle for this connection. `null` = no cycle
   * has ever completed (or the deployment predates the stamp). This is the
   * real deletion-detection latency: the hourly cron is the tick, not the
   * cycle — a cycle spans `ceil(N / budget)` ticks.
   */
  lastReconcileCompletedAt: Date | null;

  /**
   * A reconciliation cycle has started and not yet completed. NOT "actively
   * running": the sweep cursor is retained across failure backoff and
   * survives the scheduler task being disabled — it advances only when the
   * hourly tick runs and may be stalled by failures.
   */
  reconcileCycleOpen: boolean;
}
