/**
 * WooCommerce Inventory Propagation Int-Spec (#878)
 *
 * Exercises the stock-change propagation path end-to-end against a real
 * WooCommerce Testcontainer:
 *
 *   S-1 — initial stock read (50 from seed):
 *     WC product WC-SHIRT-001 has stock_quantity=50 from seed.
 *     Trigger IMasterInventorySyncService.syncFromMasterByExternalId() directly
 *     (bypasses OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED).
 *     Assert the returned MasterInventorySyncResult reports availableQuantity=50
 *     and that the inventory_items row is written to the OL DB.
 *
 *   S-2 — out-of-stock (master is authoritative including 0):
 *     PUT WC product stock_quantity to 0 via REST API.
 *     Re-sync.
 *     Assert syncResult.availableQuantity == 0 and OL DB row is updated.
 *
 *   S-3 — multi-variant product (jeans S + M):
 *     Sync variable product inventory.
 *     Assert two distinct variant-keyed inventory_items rows exist in OL DB.
 *
 * Suite-scoped: WC container boots in beforeAll, stops in afterAll.
 *
 * @module apps/api/test/integration/woocommerce
 */
import { getTestHarness, type IntegrationTestHarness } from '../setup';
import {
  startWooCommerceContainer,
  type WooCommerceTestContainer,
} from '../helpers/woocommerce-container.helper';
import { createTestWooCommerceConnection } from '../helpers/woocommerce-connection.helper';
import { drainProductSyncJobs, drainInventorySyncJobs } from '../helpers/woocommerce-sync.helper';
import { MASTER_INVENTORY_SYNC_SERVICE_TOKEN, type IMasterInventorySyncService } from '@openlinker/core/inventory';

describe('WooCommerce inventory propagation (#878)', () => {
  let harness: IntegrationTestHarness;
  let wc: WooCommerceTestContainer;
  let wcConnectionId: string;

  beforeAll(async () => {
    harness = await getTestHarness();
    wc = await startWooCommerceContainer();

    const conn = await createTestWooCommerceConnection(harness.getDataSource(), {
      siteUrl: wc.baseUrl,
      consumerKey: wc.consumerKey,
      consumerSecret: wc.consumerSecret,
      enabledCapabilities: ['ProductMaster', 'InventoryMaster'],
    });
    wcConnectionId = conn.id;

    // MANDATORY FIRST STEP: populate identifier mappings via the adapter path.
    // Without this, getExternalIds(Product, ...) returns [] and inventory sync throws.
    await drainProductSyncJobs(harness, wcConnectionId, [
      wc.simpleProductExternalId,
      wc.variableProductExternalId,
    ]);
  }, 15 * 60_000); // 15 min: WC cold boot + product sync

  afterAll(async () => {
    await wc.cleanup();
  });

  it('S-1: should sync initial stock (50) and write inventory_items row to OL DB', async () => {
    const inventorySyncService = harness
      .getApp()
      .get<IMasterInventorySyncService>(MASTER_INVENTORY_SYNC_SERVICE_TOKEN);

    const syncResult = await inventorySyncService.syncFromMasterByExternalId(
      wcConnectionId,
      wc.simpleProductExternalId,
    );

    // Assert the service return value — WC stock was read correctly
    expect(syncResult.availableQuantity).toBe(50);
    expect(syncResult.itemsWritten).toBeGreaterThan(0);

    // Assert the OL DB row was actually written (not just a service return value)
    const rows = await harness.getDataSource().query(
      `SELECT available_quantity FROM inventory_items WHERE connection_id = $1 LIMIT 10`,
      [wcConnectionId],
    ) as Array<{ available_quantity: number }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].available_quantity).toBe(50);
  });

  it('S-2: should propagate out-of-stock (0) — master is authoritative', async () => {
    const auth = Buffer
      .from(`${wc.consumerKey}:${wc.consumerSecret}`)
      .toString('base64');

    // Update stock to 0 in WC via REST API
    const res = await fetch(
      `${wc.baseUrl}/wp-json/wc/v3/products/${wc.simpleProductExternalId}`,
      {
        method: 'PUT',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_quantity: 0, manage_stock: true }),
      },
    );
    expect(res.ok).toBe(true);

    const inventorySyncService = harness
      .getApp()
      .get<IMasterInventorySyncService>(MASTER_INVENTORY_SYNC_SERVICE_TOKEN);

    const syncResult = await inventorySyncService.syncFromMasterByExternalId(
      wcConnectionId,
      wc.simpleProductExternalId,
    );

    // Assert service return: WC stock was read as 0
    expect(syncResult.availableQuantity).toBe(0);

    // Assert OL DB was updated — the row now reflects 0 (master is authoritative)
    const rows = await harness.getDataSource().query(
      `SELECT available_quantity FROM inventory_items WHERE connection_id = $1 LIMIT 10`,
      [wcConnectionId],
    ) as Array<{ available_quantity: number }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].available_quantity).toBe(0);
  });

  it('S-3: should write two distinct variant-keyed inventory_items rows for jeans (S + M)', async () => {
    await drainInventorySyncJobs(harness, wcConnectionId, [wc.variableProductExternalId]);

    // Assert two variant-keyed rows exist in OL DB — one per variation (S and M).
    // variant-keyed rows have productVariantId IS NOT NULL (per ADR-010 / #822).
    const rows = await harness.getDataSource().query(
      `SELECT "productVariantId", available_quantity
       FROM inventory_items
       WHERE connection_id = $1 AND "productVariantId" IS NOT NULL`,
      [wcConnectionId],
    ) as Array<{ productVariantId: string; available_quantity: number }>;

    // Two variations were seeded: S (stock 30) and M (stock 20)
    expect(rows).toHaveLength(2);
    const quantities = rows.map((r) => r.available_quantity).sort((a, b) => b - a);
    expect(quantities).toEqual([30, 20]);
  });
});
