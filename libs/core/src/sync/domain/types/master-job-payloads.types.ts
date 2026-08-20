/**
 * Master Job Payload Types (Generic)
 *
 * Canonical payload schemas for master.* sync jobs (master systems like PrestaShop).
 *
 * @module libs/core/src/sync/domain/types
 */

export interface MasterProductSyncByExternalIdPayloadV1 {
  schemaVersion: 1;
  externalId: string;
  objectType: 'Product';
}

export interface MasterInventorySyncByExternalIdPayloadV1 {
  schemaVersion: 1;
  externalId: string;
  objectType: 'Inventory' | 'Product';
}

/**
 * `pageLimit` bounds how many child jobs one sweep run may enqueue (#2219,
 * ADR-048 decision 4). Optional: omitting it takes the handler's drain-rate
 * derived default. The handler floors and clamps whatever arrives.
 */
export interface MasterInventorySyncAllPayloadV1 {
  schemaVersion: 1;
  pageLimit?: number;
}

/** See `MasterInventorySyncAllPayloadV1.pageLimit` (#2218). */
export interface MasterProductSyncAllPayloadV1 {
  schemaVersion: 1;
  pageLimit?: number;
}

/**
 * Incremental catalog pass (#2220, ADR-048 decisions 1/3).
 *
 * `pageLimit` behaves exactly as on the full sweep. `lookbackSeconds` overlaps the
 * change window backwards so a row whose timestamp precedes its commit is re-read
 * rather than skipped (decision 3) — never `since = lastRunAt`. Both optional; the
 * handler floors and clamps whatever arrives.
 */
export interface MasterProductSyncDeltaPayloadV1 {
  schemaVersion: 1;
  pageLimit?: number;
  lookbackSeconds?: number;
}

/**
 * Deletion reconciliation over OL's own mappings (#2222).
 *
 * `pageLimit` behaves as on the sweeps. There is no watermark and no lookback:
 * this pass carries no notion of "changed since", only "still there?".
 */
export interface MasterProductReconcilePayloadV1 {
  schemaVersion: 1;
  pageLimit?: number;
}

