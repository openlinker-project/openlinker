/**
 * Inventory manual correction - against a real database (#3566)
 *
 * The service is built from the app's REAL repositories, a REAL `InventoryService`
 * and the REAL products service; only the product master adapter and the
 * integrations lookup are faked, because what is proved is OpenLinker's side of
 * the boundary: the pending claim on `idempotencyKey`, the mirror write, and the
 * ledger row the attach completes. A route-level int-spec is deliberately not
 * written: the harness has no way to register a fake `InventoryMaster` adapter
 * behind a connection, so the HTTP shape is covered by the controller and filter
 * unit specs instead.
 *
 * @module apps/api/test/integration
 */
import type { DataSource } from 'typeorm';

import {
  INVENTORY_MOVEMENT_REPOSITORY_TOKEN,
  INVENTORY_REPOSITORY_TOKEN,
  INVENTORY_SERVICE_TOKEN,
  InventoryCorrectionService,
  type IInventoryService,
  type InventoryAdjustmentResult,
} from '@openlinker/core/inventory';
import { InventoryItemOrmEntity } from '@openlinker/core/inventory/orm-entities';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import { PRODUCTS_SERVICE_TOKEN, type IProductsService } from '@openlinker/core/products';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';
import {
  SYNC_JOB_QUEUE_TOKEN,
  SYNC_LOCK_TOKEN,
  type SyncJobQueuePort,
  type SyncLockPort,
} from '@openlinker/core/sync';

import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';

const SHOP = '11111111-1111-1111-1111-111111111111';

async function seedPosition(
  dataSource: DataSource,
  available: number
): Promise<{ productId: string; variantId: string; inventoryItemId: string }> {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const productId = `ol_product_corr_${suffix}`;
  const variantId = `ol_variant_corr_${suffix}`;
  const inventoryItemId = `ol_inventory_corr_${suffix}`;

  const products = dataSource.getRepository(ProductOrmEntity);
  await products.save(
    products.create({ id: productId, name: `Corr ${suffix}`, sku: null, price: null })
  );
  const variants = dataSource.getRepository(ProductVariantOrmEntity);
  await variants.save(
    variants.create({ id: variantId, productId, sku: null, attributes: null, ean: null, gtin: null })
  );
  const inventory = dataSource.getRepository(InventoryItemOrmEntity);
  await inventory.save(
    inventory.create({
      id: inventoryItemId,
      productId,
      productVariantId: variantId,
      availableQuantity: available,
      reservedQuantity: 0,
      locationId: null,
      isStale: false,
      sourceConnectionId: SHOP,
    })
  );
  return { productId, variantId, inventoryItemId };
}

describe('Inventory manual correction (#3566)', () => {
  let harness: IntegrationTestHarness;
  let service: InventoryCorrectionService;
  let adjustInventory: jest.Mock;
  let enqueueSpy: jest.SpyInstance;

  beforeAll(async () => {
    harness = await getTestHarness();
  }, 180000);

  afterAll(async () => {
    await teardownTestHarness();
  });

  beforeEach(async () => {
    await resetTestHarness();
    const app = harness.getApp();

    let masterStock = 10;
    adjustInventory = jest.fn(({ quantity }: { quantity: number }) => {
      masterStock = Math.max(0, masterStock + quantity);
      return Promise.resolve({
        id: 'master',
        productId: 'x',
        quantity: masterStock,
        reserved: 0,
        available: masterStock,
        adjustmentOutcome: { disposition: 'applied', idempotency: 'honoured', appliedAt: null },
      } satisfies InventoryAdjustmentResult);
    });
    const adapter = {
      adjustInventory,
      listInventory: jest.fn(() => Promise.resolve([])),
    };
    const integrations = {
      listCapabilityAdapters: jest.fn(() =>
        Promise.resolve([
          {
            connectionId: SHOP,
            connection: { id: SHOP, name: 'Shop', platformType: 'prestashop' },
            adapter,
          },
        ])
      ),
      getCapabilityAdapter: jest.fn(() => Promise.resolve(adapter)),
    } as unknown as IIntegrationsService;

    const queue = app.get<SyncJobQueuePort>(SYNC_JOB_QUEUE_TOKEN);
    enqueueSpy = jest.spyOn(queue, 'enqueue').mockResolvedValue('job-id');

    type Deps = ConstructorParameters<typeof InventoryCorrectionService>;
    service = new InventoryCorrectionService(
      app.get<Deps[0]>(INVENTORY_REPOSITORY_TOKEN),
      app.get<Deps[1]>(INVENTORY_MOVEMENT_REPOSITORY_TOKEN),
      app.get<IInventoryService>(INVENTORY_SERVICE_TOKEN),
      integrations,
      app.get<IProductsService>(PRODUCTS_SERVICE_TOKEN),
      app.get<SyncLockPort>(SYNC_LOCK_TOKEN)
    );
  });

  afterEach(() => {
    enqueueSpy.mockRestore();
  });

  it('should write the master, mirror the answer and complete one applied ledger row', async () => {
    const dataSource = harness.getDataSource();
    const { variantId, inventoryItemId } = await seedPosition(dataSource, 10);

    const result = await service.correctStock({
      productVariantId: variantId,
      mode: 'delta',
      quantity: 5,
      operatorReason: 'found',
      actorUserId: 'user-1',
    });

    expect(result).toMatchObject({
      status: 'applied',
      requestedDelta: 5,
      quantityBefore: 10,
      quantityAfter: 15,
      deduplicated: false,
    });
    const row = await dataSource
      .getRepository(InventoryItemOrmEntity)
      .findOneOrFail({ where: { id: inventoryItemId } });
    expect(row.availableQuantity).toBe(15);

    const ledger = await dataSource.query<Array<{ status: string; reason: string }>>(
      `SELECT status, reason FROM inventory_movements WHERE "productVariantId" = $1`,
      [variantId]
    );
    expect(ledger).toEqual([{ status: 'applied', reason: 'manual_correction' }]);
  });

  it('should cross the boundary once when the same key is submitted twice', async () => {
    const { variantId } = await seedPosition(harness.getDataSource(), 10);
    const input = {
      productVariantId: variantId,
      mode: 'delta' as const,
      quantity: 2,
      operatorReason: 'found' as const,
      idempotencyKey: '7b2f2b0a-3c43-4c0b-8f3a-1d0f9d6b6f10',
      actorUserId: 'user-1',
    };

    const first = await service.correctStock(input);
    const second = await service.correctStock(input);

    expect(adjustInventory).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ deduplicated: true, movementId: first.movementId });
  });

  it('should cross the boundary once across overlapping submissions of one key', async () => {
    const { variantId } = await seedPosition(harness.getDataSource(), 10);
    const input = {
      productVariantId: variantId,
      mode: 'delta' as const,
      quantity: 1,
      operatorReason: 'found' as const,
      idempotencyKey: '7b2f2b0a-3c43-4c0b-8f3a-1d0f9d6b6f11',
      actorUserId: 'user-1',
    };

    await Promise.allSettled(Array.from({ length: 4 }, () => service.correctStock(input)));

    expect(adjustInventory).toHaveBeenCalledTimes(1);
  });
});
