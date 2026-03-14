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

