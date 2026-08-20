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

