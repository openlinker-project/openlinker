/**
 * Stock-Location Override — Pooled-to-Located Transition, End-to-End (#3206)
 *
 * The unit tests already pin that `MasterInventorySyncService` resolves
 * `inventory.locationId ?? override ?? null` and that it feeds the *effective*
 * (post-override) locationId into the same #2322 pooled/located tracking a
 * genuine adapter-reported location would take. What none of that proves is
 * the thing #3206's own acceptance criterion asks for: that turning the
 * override ON for a connection whose stock is already pooled in real Postgres
 * actually converges — the old `locationId IS NULL` row ends up `isStale`,
 * exactly one located row exists at the override's location, and the
 * available quantity is the original figure, not double-counted in between.
 *
 * Modelled directly on the sibling `#2324` end-to-end spec
 * (`inventory-location-propagation-e2e.int-spec.ts`), which already drives
 * `MasterInventorySyncService.syncFromMasterByExternalId` against a real
 * connection + a mocked `InventoryMasterPort` and reads back real rows —
 * the more faithful precedent for THIS claim than the `#2322`-only
 * `IInventoryService`-level spec, since the override is applied inside the
 * sync service itself, not at the repository layer that spec exercises.
 *
 * @module apps/worker/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { WorkerIntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { InventoryMasterPort, IMasterInventorySyncService } from '@openlinker/core/inventory';
import { MASTER_INVENTORY_SYNC_SERVICE_TOKEN } from '@openlinker/core/inventory';
import { InventoryItemOrmEntity } from '@openlinker/core/inventory/orm-entities';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';
import { IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import { ConnectionOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import type { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

const OVERRIDE_LOCATION_ID = 'warehouse-override';

describe('Stock-location override — pooled-to-located transition end-to-end (#3206)', () => {
  let harness: WorkerIntegrationTestHarness;
  let dataSource: DataSource;
  let integrationsService: IIntegrationsService;

  beforeAll(async () => {
    // Set BEFORE the container boots, so running this file alone
    // (`--runTestsByPath`) does not die in `getPiiConfig` before reaching
    // anything this spec is about — the `oms-module-boot.int-spec.ts` precedent.
    process.env.OL_PII_HASH_SALT ??= 'test-salt-for-integration-tests';

    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    integrationsService = harness.get(INTEGRATIONS_SERVICE_TOKEN);
  });

  beforeEach(async () => {
    await resetTestHarness();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  /** Seeds a product + one variant + its `Product` identifier mapping. */
  async function seedVariant(
    connectionId: string
  ): Promise<{ productId: string; variantId: string; externalId: string }> {
    const suffix = randomUUID().replace(/-/g, '');
    const productId = `ol_product_${suffix}`;
    const variantId = `ol_variant_${suffix}`;
    const externalId = `ext-${suffix.slice(0, 8)}`;

    const mappingRepo = dataSource.getRepository(IdentifierMappingOrmEntity);
    await mappingRepo.save(
      mappingRepo.create({
        entityType: 'Product',
        internalId: productId,
        externalId,
        platformType: 'prestashop',
        connectionId,
        context: null,
      })
    );

    const productRepo = dataSource.getRepository(ProductOrmEntity);
    await productRepo.save(productRepo.create({ id: productId, name: 'Override Test' }));

    const variantRepo = dataSource.getRepository(ProductVariantOrmEntity);
    await variantRepo.save(
      variantRepo.create({ id: variantId, productId, sku: `SKU-${suffix.slice(0, 6)}` })
    );

    return { productId, variantId, externalId };
  }

  /** A fake `InventoryMasterPort` that never locates — matches both shipped adapters. */
  function pooledOnlyAdapter(input: {
    externalId: string;
    variantId: string;
    quantity: number;
  }): InventoryMasterPort {
    return {
      listInventory: jest.fn().mockResolvedValue([
        {
          id: `inv-${input.externalId}`,
          productId: input.externalId,
          variantId: input.variantId,
          quantity: input.quantity,
          reserved: 0,
          available: input.quantity,
          locationId: undefined,
        },
      ]),
      getInventory: jest.fn(),
      adjustInventory: jest.fn(),
      reserveInventory: jest.fn(),
      releaseInventory: jest.fn(),
      getAvailableQuantity: jest.fn(),
    } as unknown as InventoryMasterPort;
  }

  async function readRows(
    productId: string,
    variantId: string
  ): Promise<InventoryItemOrmEntity[]> {
    return dataSource
      .getRepository(InventoryItemOrmEntity)
      .find({ where: { productId, productVariantId: variantId } });
  }

  it('stales the pooled row and writes one located row once the override is set, with no double-count', async () => {
    const master = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      status: 'active',
      config: { baseUrl: 'http://localhost:8080', preferredLanguageId: 1 },
    });
    const { productId, variantId, externalId } = await seedVariant(master.id);

    jest
      .spyOn(integrationsService, 'getCapabilityAdapter')
      .mockResolvedValue(pooledOnlyAdapter({ externalId, variantId, quantity: 8 }));

    const masterSync = harness.get<IMasterInventorySyncService>(MASTER_INVENTORY_SYNC_SERVICE_TOKEN);

    // First sync: no override configured yet — the pre-#3206 behaviour, one
    // pooled row, nothing to repair.
    const first = await masterSync.syncFromMasterByExternalId(master.id, externalId);
    expect(first.pooledPositionsStaled ?? 0).toBe(0);

    const afterFirst = await readRows(productId, variantId);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].locationId).toBeNull();
    expect(afterFirst[0].isStale).toBe(false);
    expect(afterFirst[0].availableQuantity).toBe(8);

    // The operator now asserts a location for this connection's stock. The
    // adapter is UNCHANGED — it still reports no location of its own — so any
    // effect below is attributable to the override alone.
    await dataSource
      .getRepository(ConnectionOrmEntity)
      .update(
        { id: master.id },
        { config: { baseUrl: 'http://localhost:8080', preferredLanguageId: 1, stockLocationOverride: OVERRIDE_LOCATION_ID } }
      );

    // Second sync: same adapter response, override now active.
    const second = await masterSync.syncFromMasterByExternalId(master.id, externalId);
    expect(second.pooledPositionsStaled ?? 0).toBeGreaterThan(0);

    const afterSecond = await readRows(productId, variantId);
    expect(afterSecond).toHaveLength(2);

    const pooled = afterSecond.find((r) => r.locationId === null);
    const located = afterSecond.find((r) => r.locationId === OVERRIDE_LOCATION_ID);

    // The old row survives (SOFT repair) but is stale — not stock any more.
    expect(pooled?.isStale).toBe(true);
    // The new row sits at the override's location and is live.
    expect(located?.isStale).toBe(false);
    expect(located?.availableQuantity).toBe(8);

    // No double count: only ONE of the two rows is live at once, and its
    // quantity is the same 8 the adapter has reported all along.
    const liveTotal = afterSecond
      .filter((r) => !r.isStale)
      .reduce((sum, r) => sum + r.availableQuantity, 0);
    expect(liveTotal).toBe(8);
  });

  it('never applies the override once the adapter reports a real location itself', async () => {
    const master = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      status: 'active',
      config: {
        baseUrl: 'http://localhost:8080',
        preferredLanguageId: 1,
        stockLocationOverride: OVERRIDE_LOCATION_ID,
      },
    });
    const { productId, variantId, externalId } = await seedVariant(master.id);

    const REAL_LOCATION_ID = 'warehouse-real';
    jest.spyOn(integrationsService, 'getCapabilityAdapter').mockResolvedValue({
      listInventory: jest.fn().mockResolvedValue([
        {
          id: `inv-${externalId}`,
          productId: externalId,
          variantId,
          quantity: 5,
          reserved: 0,
          available: 5,
          locationId: REAL_LOCATION_ID,
        },
      ]),
      getInventory: jest.fn(),
      adjustInventory: jest.fn(),
      reserveInventory: jest.fn(),
      releaseInventory: jest.fn(),
      getAvailableQuantity: jest.fn(),
    } as unknown as InventoryMasterPort);

    const masterSync = harness.get<IMasterInventorySyncService>(MASTER_INVENTORY_SYNC_SERVICE_TOKEN);

    await masterSync.syncFromMasterByExternalId(master.id, externalId);

    const rows = await readRows(productId, variantId);
    expect(rows).toHaveLength(1);
    // The adapter's own answer wins — the override configured on this
    // connection is never consulted once the master actually locates.
    expect(rows[0].locationId).toBe(REAL_LOCATION_ID);
    expect(rows[0].isStale).toBe(false);
  });
});
