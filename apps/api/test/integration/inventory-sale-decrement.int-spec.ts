/**
 * Inventory Sale Decrement — against a real database (#3453)
 *
 * **This must be an int-spec, not only a unit spec.** The at-most-once guarantee
 * is the UNIQUE index on `inventory_sale_decrements."idempotencyKey"` and the
 * conditional `ON CONFLICT … DO UPDATE … WHERE status = 'retryable'` that claims
 * against it. A mocked repository can prove the service CALLS `claim`, but only a
 * real database can prove N overlapping claims produce exactly ONE adapter call —
 * a `SELECT`-then-`INSERT` would pass every unit spec and enforce nothing at READ
 * COMMITTED, where the conflicting row is a phantom until it exists.
 *
 * The service is built from the app's REAL repositories and a REAL
 * `InventoryService`; only the product master adapter is faked, because what is
 * being proved is OpenLinker's side of the boundary. The job queue is spied on
 * rather than stubbed out of the graph, so the propagation enqueue asserted below
 * is the one `InventoryService.setInventory` really makes.
 *
 * @module apps/api/test/integration
 */
import type { DataSource } from 'typeorm';

import {
  INVENTORY_REPOSITORY_TOKEN,
  INVENTORY_SALE_DECREMENT_REPOSITORY_TOKEN,
  INVENTORY_SERVICE_TOKEN,
  InventorySaleDecrementService,
  type IInventoryService,
  type InventoryAdjustmentResult,
} from '@openlinker/core/inventory';
import { InventoryItemOrmEntity } from '@openlinker/core/inventory/orm-entities';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';
import { SYNC_JOB_QUEUE_TOKEN, type SyncJobQueuePort } from '@openlinker/core/sync';

import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';

const SHOP = '11111111-1111-1111-1111-111111111111';
const ALLEGRO = '22222222-2222-2222-2222-222222222222';

async function seedPosition(
  dataSource: DataSource,
  available: number
): Promise<{ productId: string; variantId: string; inventoryItemId: string }> {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const productId = `ol_product_sale_${suffix}`;
  const variantId = `ol_variant_sale_${suffix}`;
  const inventoryItemId = `ol_inventory_sale_${suffix}`;

  const products = dataSource.getRepository(ProductOrmEntity);
  await products.save(
    products.create({ id: productId, name: `Sale ${suffix}`, sku: null, price: null })
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

describe('Inventory sale decrement (#3453)', () => {
  let harness: IntegrationTestHarness;
  let service: InventorySaleDecrementService;
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

    // The product master: `available` counts down like a real shop's stock.
    let masterStock = 1;
    adjustInventory = jest.fn(({ quantity }: { quantity: number }) => {
      masterStock = Math.max(0, masterStock + quantity);
      return Promise.resolve({
        id: 'master',
        productId: 'x',
        quantity: masterStock,
        reserved: 0,
        available: masterStock,
        // The adapter admits it CANNOT dedupe — the Postgres claim is the only guard.
        adjustmentOutcome: { disposition: 'applied', idempotency: 'unsupported', appliedAt: null },
      } satisfies InventoryAdjustmentResult);
    });
    const integrations = {
      getCapabilityAdapter: jest.fn(() =>
        Promise.resolve({
          adjustInventory,
          listInventory: jest.fn(() => Promise.resolve([])),
        })
      ),
    } as unknown as IIntegrationsService;

    const queue = app.get<SyncJobQueuePort>(SYNC_JOB_QUEUE_TOKEN);
    enqueueSpy = jest.spyOn(queue, 'enqueue').mockResolvedValue('job-id');

    // Typed through the constructor rather than by importing the ports:
    // `*RepositoryPort` is an intra-context contract the cross-context guard denies.
    type Deps = ConstructorParameters<typeof InventorySaleDecrementService>;
    service = new InventorySaleDecrementService(
      app.get<Deps[0]>(INVENTORY_REPOSITORY_TOKEN),
      app.get<Deps[1]>(INVENTORY_SALE_DECREMENT_REPOSITORY_TOKEN, { strict: false }),
      app.get<IInventoryService>(INVENTORY_SERVICE_TOKEN),
      integrations
    );
  });

  afterEach(() => {
    enqueueSpy.mockRestore();
  });

  const decrement = (productId: string, variantId: string, workId = 'ol_work_sale') =>
    service.decrementForWork({
      orderId: 'ol_order_sale',
      workId,
      orderSourceConnectionId: ALLEGRO,
      locationId: null,
      lines: [{ orderLineId: 'line-1', productId, productVariantId: variantId, quantity: 1 }],
    });

  // The issue's regression: the last unit sells on Allegro with the OMS on.
  it('should take the product master to 0 and propagate it when the last unit sells', async () => {
    const dataSource = harness.getDataSource();
    const { productId, variantId, inventoryItemId } = await seedPosition(dataSource, 1);

    const result = await decrement(productId, variantId);

    expect(result.lines[0]).toMatchObject({ status: 'applied', ownerConnectionId: SHOP });
    expect(adjustInventory).toHaveBeenCalledWith(
      expect.objectContaining({
        productId,
        variantId,
        quantity: -1,
        reason: 'order_sale',
        idempotencyKey: `sale:${SHOP}:ol_work_sale:line-1`,
      })
    );

    const row = await dataSource
      .getRepository(InventoryItemOrmEntity)
      .findOneOrFail({ where: { id: inventoryItemId } });
    expect(row.availableQuantity).toBe(0);

    // Straight away, from the owner — the marketplaces are told the unit is gone.
    const propagations = (
      enqueueSpy.mock.calls as [
        { type: string; connectionId: string; payload: Record<string, unknown> },
      ][]
    )
      .map(([request]) => request)
      .filter((request) => request.type === 'inventory.propagateToMarketplaces');
    expect(propagations).toHaveLength(1);
    expect(propagations[0].connectionId).toBe(SHOP);
    expect(propagations[0].payload).toMatchObject({ productId, variantId });
  });

  it('should never decrement twice on replays, even though the adapter cannot dedupe', async () => {
    const { productId, variantId } = await seedPosition(harness.getDataSource(), 5);

    await decrement(productId, variantId);
    await decrement(productId, variantId);
    await decrement(productId, variantId);

    expect(adjustInventory).toHaveBeenCalledTimes(1);
  });

  it('should cross the boundary exactly once across N overlapping runs', async () => {
    const { productId, variantId } = await seedPosition(harness.getDataSource(), 5);

    // Deterministic without a lock-step harness because the guarantee is the
    // database's: whichever INSERT commits second conflicts. `1`, not `>= 1`.
    await Promise.all(Array.from({ length: 8 }, () => decrement(productId, variantId)));

    expect(adjustInventory).toHaveBeenCalledTimes(1);
    const rows = await harness
      .getDataSource()
      .query<{ status: string }[]>(
        `SELECT "status" FROM "inventory_sale_decrements" WHERE "workId" = 'ol_work_sale'`
      );
    expect(rows).toHaveLength(1);
  });

  it('should decrement a different work for the same line independently', async () => {
    const { productId, variantId } = await seedPosition(harness.getDataSource(), 5);

    await decrement(productId, variantId, 'ol_work_a');
    await decrement(productId, variantId, 'ol_work_b');

    expect(adjustInventory).toHaveBeenCalledTimes(2);
  });

  it('should persist the skip when the order came from the product master itself', async () => {
    const { productId, variantId } = await seedPosition(harness.getDataSource(), 5);

    const result = await service.decrementForWork({
      orderId: 'ol_order_sale',
      workId: 'ol_work_sale',
      orderSourceConnectionId: SHOP,
      locationId: null,
      lines: [{ orderLineId: 'line-1', productId, productVariantId: variantId, quantity: 1 }],
    });

    expect(result.lines[0]).toMatchObject({ status: 'skipped', reason: 'source-is-owner' });
    expect(adjustInventory).not.toHaveBeenCalled();
    const [row] = await harness
      .getDataSource()
      .query<{ status: string; reason: string }[]>(
        `SELECT "status", "reason" FROM "inventory_sale_decrements"`
      );
    expect(row).toEqual({ status: 'skipped', reason: 'source-is-owner' });
  });

  it('should store a positive quantity only', async () => {
    await expect(
      harness.getDataSource().query(
        `INSERT INTO "inventory_sale_decrements"
           ("idempotencyKey","orderId","workId","orderLineId","productId","quantity","status")
         VALUES ('k','o','w','l','p',0,'pending')`
      )
    ).rejects.toThrow();
  });
});
