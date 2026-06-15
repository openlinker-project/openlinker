/**
 * WooCommerce Integration Test Sync Helpers (#878)
 *
 * Direct service invocation helpers for driving WC sync flows in int-specs.
 * Follows the drainBulkBatch pattern: harness.getApp().get<IService>(TOKEN).
 *
 * ARCHITECTURE CONTRACT — identifier mappings must be populated via these helpers,
 * NOT by direct insertion into the identifier_mappings table.
 * Direct DB insertion bypasses the adapter layer and is an architecture violation.
 * The correct path: syncFromMasterByExternalId() calls ProductMasterPort.getProduct()
 * + getProductVariants() → IdentifierMappingService.getOrCreateInternalId() —
 * the same path as production.
 *
 * Usage: call drainProductSyncJobs() as the FIRST setup step in ALL three WC int-specs.
 *
 * @module apps/api/test/integration/helpers
 */
import {
  MASTER_PRODUCT_SYNC_SERVICE_TOKEN,
  type IMasterProductSyncService,
} from '@openlinker/core/products';
import {
  MASTER_INVENTORY_SYNC_SERVICE_TOKEN,
  type IMasterInventorySyncService,
} from '@openlinker/core/inventory';
import type { IntegrationTestHarness } from '../setup';

/**
 * Syncs each WC product by external ID through the full application service path,
 * creating identifier mappings for:
 *   - Simple products → internal product + synthetic variant ("product:{wcId}")
 *   - Variable products → internal product + real variant mappings (one per variation)
 *
 * @param externalIds  WC product external IDs from WooCommerceTestContainer
 *                     (simpleProductExternalId + variableProductExternalId)
 */
export async function drainProductSyncJobs(
  harness: IntegrationTestHarness,
  connectionId: string,
  externalIds: string[],
): Promise<void> {
  const syncService = harness
    .getApp()
    .get<IMasterProductSyncService>(MASTER_PRODUCT_SYNC_SERVICE_TOKEN);

  for (const externalId of externalIds) {
    await syncService.syncFromMasterByExternalId(connectionId, externalId);
  }
}

/**
 * Syncs inventory for each WC product by external ID.
 * Call AFTER drainProductSyncJobs() — requires identifier mappings to exist first.
 *
 * @param externalIds  WC product external IDs to sync inventory for
 */
export async function drainInventorySyncJobs(
  harness: IntegrationTestHarness,
  connectionId: string,
  externalIds: string[],
): Promise<void> {
  const syncService = harness
    .getApp()
    .get<IMasterInventorySyncService>(MASTER_INVENTORY_SYNC_SERVICE_TOKEN);

  for (const externalId of externalIds) {
    await syncService.syncFromMasterByExternalId(connectionId, externalId);
  }
}
