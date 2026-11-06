/**
 * Bundle definition -> frozen expansion -> reservation -> sale decrement (#3607)
 *
 * Against a real database, because the two guarantees that matter are database
 * facts: the expansion is written ONCE (a conditional `IS NULL` UPDATE, so a
 * later definition edit cannot reach an open order) and a reservation is
 * all-or-nothing per call (one transaction). Only the product master adapter is
 * faked.
 *
 * @module apps/api/test/integration
 */
import type { DataSource } from 'typeorm';

import {
  INVENTORY_REPOSITORY_TOKEN,
  INVENTORY_SALE_DECREMENT_REPOSITORY_TOKEN,
  INVENTORY_SERVICE_TOKEN,
  InsufficientAvailabilityError,
  InventorySaleDecrementService,
  RESERVATION_SERVICE_TOKEN,
  type IInventoryService,
  type IReservationService,
  type InventoryAdjustmentResult,
} from '@openlinker/core/inventory';
import { InventoryItemOrmEntity } from '@openlinker/core/inventory/orm-entities';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import {
  ORDER_PROVISIONING_RESUME_SERVICE_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
  type IOrderProvisioningResumeService,
  type IOrderRecordService,
} from '@openlinker/core/orders';
import {
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  type IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import { OrderRecordOrmEntity } from '@openlinker/core/orders/orm-entities';
import {
  BUNDLE_DEFINITION_SERVICE_TOKEN,
  BundleNestingError,
  buildPackLineDefinitions,
  type IBundleDefinitionService,
} from '@openlinker/core/products';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';
import {
  SYNC_JOB_QUEUE_TOKEN,
  SYNC_LOCK_TOKEN,
  type SyncJobQueuePort,
  type SyncLockPort,
} from '@openlinker/core/sync';

import { createTestConnection } from './helpers/test-connection.helper';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';

const SHOP = '11111111-1111-4111-8111-111111111111';
const ALLEGRO = '22222222-2222-4222-8222-222222222222';
const ORDER_ID = 'ol_order_bundle';

async function seedVariant(
  dataSource: DataSource,
  id: string,
  available: number | null
): Promise<void> {
  const products = dataSource.getRepository(ProductOrmEntity);
  await products.save(products.create({ id: `p_${id}`, name: id, sku: null, price: null }));
  const variants = dataSource.getRepository(ProductVariantOrmEntity);
  await variants.save(
    variants.create({ id, productId: `p_${id}`, sku: null, attributes: null, ean: null, gtin: null })
  );
  if (available === null) return;
  const inventory = dataSource.getRepository(InventoryItemOrmEntity);
  await inventory.save(
    inventory.create({
      id: `inv_${id}`,
      productId: `p_${id}`,
      productVariantId: id,
      availableQuantity: available,
      reservedQuantity: 0,
      locationId: null,
      isStale: false,
      sourceConnectionId: SHOP,
    })
  );
}

describe('Bundle expansion, from definition to decrement (#3607)', () => {
  let harness: IntegrationTestHarness;
  let bundles: IBundleDefinitionService;
  let orderRecords: IOrderRecordService;
  let reservations: IReservationService;
  let decrements: InventorySaleDecrementService;
  let adjustInventory: jest.Mock;

  beforeAll(async () => {
    harness = await getTestHarness();
  }, 180000);

  afterAll(async () => {
    await teardownTestHarness();
  });

  beforeEach(async () => {
    await resetTestHarness();
    const app = harness.getApp();
    bundles = app.get<IBundleDefinitionService>(BUNDLE_DEFINITION_SERVICE_TOKEN);
    orderRecords = app.get<IOrderRecordService>(ORDER_RECORD_SERVICE_TOKEN);
    reservations = app.get<IReservationService>(RESERVATION_SERVICE_TOKEN);

    adjustInventory = jest.fn(() =>
      Promise.resolve({
        id: 'master',
        productId: 'x',
        quantity: 0,
        reserved: 0,
        available: 0,
        adjustmentOutcome: { disposition: 'applied', idempotency: 'unsupported', appliedAt: null },
      } satisfies InventoryAdjustmentResult)
    );
    const integrations = {
      getCapabilityAdapter: jest.fn(() =>
        Promise.resolve({ adjustInventory, listInventory: jest.fn(() => Promise.resolve([])) })
      ),
    } as unknown as IIntegrationsService;
    jest.spyOn(app.get<SyncJobQueuePort>(SYNC_JOB_QUEUE_TOKEN), 'enqueue').mockResolvedValue('job');

    type Deps = ConstructorParameters<typeof InventorySaleDecrementService>;
    decrements = new InventorySaleDecrementService(
      app.get<Deps[0]>(INVENTORY_REPOSITORY_TOKEN),
      app.get<Deps[1]>(INVENTORY_SALE_DECREMENT_REPOSITORY_TOKEN, { strict: false }),
      app.get<IInventoryService>(INVENTORY_SERVICE_TOKEN),
      integrations,
      app.get<SyncLockPort>(SYNC_LOCK_TOKEN),
      reservations
    );
  });

  afterEach(() => jest.restoreAllMocks());

  async function seedOrder(): Promise<void> {
    const repo = harness.getDataSource().getRepository(OrderRecordOrmEntity);
    await repo.save(
      repo.create({
        internalOrderId: ORDER_ID,
        customerId: null,
        sourceConnectionId: ALLEGRO,
        sourceEventId: null,
        orderSnapshot: {
          items: [
            { id: 'line-1', productId: 'p_set', variantId: 'v_set', quantity: 2, price: 50 },
          ],
        },
        syncStatus: [],
        recordStatus: 'ready',
        cancelledAt: null,
      })
    );
  }

  it('should refuse nesting both ways with a named error', async () => {
    const ds = harness.getDataSource();
    await seedVariant(ds, 'v_set', null);
    await seedVariant(ds, 'v_a', 10);
    await seedVariant(ds, 'v_set2', null);
    await bundles.create('v_set', [{ variantId: 'v_a', quantity: 1 }]);

    // a bundle cannot contain a bundle ...
    await expect(bundles.create('v_set2', [{ variantId: 'v_set', quantity: 1 }])).rejects.toMatchObject(
      { name: 'BundleNestingError', reason: 'component-is-bundle' }
    );
    // ... and a component variant cannot become a bundle.
    await expect(bundles.create('v_a', [{ variantId: 'v_set2', quantity: 1 }])).rejects.toBeInstanceOf(
      BundleNestingError
    );
  });

  it('should freeze once, reserve and decrement per component, and ignore a later definition edit', async () => {
    const ds = harness.getDataSource();
    await seedVariant(ds, 'v_set', null);
    await seedVariant(ds, 'v_a', 10);
    await seedVariant(ds, 'v_b', 10);
    await seedOrder();

    const definition = await bundles.create('v_set', [
      { variantId: 'v_a', quantity: 3 },
      { variantId: 'v_b', quantity: 1 },
    ]);
    expect(definition.version).toBe(1);

    const frozen = await orderRecords.freezeLineExpansion(ORDER_ID, {
      v: 1,
      definitions: await bundles.findCurrentByVariantIds(['v_set']),
    });
    expect(frozen.definitions[0].version).toBe(1);

    // Editing the definition afterwards does not reach the open order.
    await bundles.update('v_set', [{ variantId: 'v_a', quantity: 9 }]);
    const again = await orderRecords.freezeLineExpansion(ORDER_ID, { v: 1, definitions: [] });
    expect(again.definitions[0].components).toHaveLength(2);

    const record = await orderRecords.getOrderRecord(ORDER_ID);
    expect(record).not.toBeNull();
    const physical = record!.physicalItems;
    expect(record!.orderItems.map((i) => i.id)).toEqual(['line-1']);
    expect(physical.map((i) => [i.id, i.productId, i.quantity])).toEqual([
      ['line-1~c:v_a', 'p_v_a', 6],
      ['line-1~c:v_b', 'p_v_b', 2],
    ]);

    await reservations.reserveForOrder({
      orderRecordId: ORDER_ID,
      atpEffect: 'published',
      lines: physical.map((i) => ({
        orderLineId: i.id,
        productId: i.productId,
        productVariantId: i.variantId ?? null,
        quantity: i.quantity,
      })),
    });
    const held = await ds.query<{ orderLineId: string; quantity: number }[]>(
      `SELECT "orderLineId", "quantity" FROM "reservations" WHERE "orderRecordId" = $1 ORDER BY "orderLineId"`,
      [ORDER_ID]
    );
    expect(held).toEqual([
      { orderLineId: 'line-1~c:v_a', quantity: 6 },
      { orderLineId: 'line-1~c:v_b', quantity: 2 },
    ]);

    const result = await decrements.decrementForWork({
      orderId: ORDER_ID,
      workId: 'ol_work_bundle',
      orderSourceConnectionId: ALLEGRO,
      locationId: null,
      lines: physical.map((i) => ({
        orderLineId: i.id,
        productId: i.productId,
        productVariantId: i.variantId ?? null,
        quantity: i.quantity,
      })),
    });
    expect(result.lines).toHaveLength(2);
    expect(adjustInventory).toHaveBeenCalledWith(
      expect.objectContaining({ variantId: 'v_a', quantity: -6 })
    );
    expect(adjustInventory).toHaveBeenCalledWith(
      expect.objectContaining({ variantId: 'v_b', quantity: -2 })
    );
  });

  it('should let a confirmed multipack through and reserve N units of its own variant (#3624)', async () => {
    const ds = harness.getDataSource();
    await seedVariant(ds, 'v_coffee', 10);
    const repo = ds.getRepository(OrderRecordOrmEntity);
    await repo.save(
      repo.create({
        internalOrderId: ORDER_ID,
        customerId: null,
        sourceConnectionId: ALLEGRO,
        sourceEventId: null,
        orderSnapshot: {
          items: [
            {
              id: 'line-1',
              productId: 'p_v_coffee',
              variantId: 'v_coffee',
              quantity: 1,
              price: 95,
              packQuantity: 3,
            },
          ],
        },
        syncStatus: [],
        recordStatus: 'ready',
        cancelledAt: null,
      })
    );

    // Held until confirmed, then not held; confirming twice is harmless.
    expect(await bundles.findConfirmedMultipacks([{ variantId: 'v_coffee', packQuantity: 3 }])).toEqual([]);
    await bundles.confirmMultipack({ variantId: 'v_coffee', packQuantity: 3 }, null);
    await bundles.confirmMultipack({ variantId: 'v_coffee', packQuantity: 3 }, null);
    const confirmed = await bundles.findConfirmedMultipacks([
      { variantId: 'v_coffee', packQuantity: 3 },
      { variantId: 'v_coffee', packQuantity: 6 },
    ]);
    expect(confirmed).toEqual([{ variantId: 'v_coffee', packQuantity: 3 }]);

    const record = await orderRecords.getOrderRecord(ORDER_ID);
    const lineDefinitions = buildPackLineDefinitions(record!.orderItems, [], confirmed);
    await orderRecords.freezeLineExpansion(ORDER_ID, { v: 1, definitions: lineDefinitions });

    const physical = (await orderRecords.getOrderRecord(ORDER_ID))!.physicalItems;
    expect(physical.map((i) => [i.id, i.productId, i.quantity])).toEqual([
      ['line-1~c:v_coffee', 'p_v_coffee', 3],
    ]);
    await reservations.reserveForOrder({
      orderRecordId: ORDER_ID,
      atpEffect: 'published',
      lines: physical.map((i) => ({
        orderLineId: i.id,
        productId: i.productId,
        productVariantId: i.variantId ?? null,
        quantity: i.quantity,
      })),
    });
    const held = await ds.query<{ orderLineId: string; quantity: number }[]>(
      'SELECT "orderLineId", "quantity" FROM "reservations" WHERE "orderRecordId" = $1',
      [ORDER_ID]
    );
    expect(held).toEqual([{ orderLineId: 'line-1~c:v_coffee', quantity: 3 }]);
  });

  it('should reserve all-or-nothing and name the short component', async () => {
    const ds = harness.getDataSource();
    await seedVariant(ds, 'v_set', null);
    await seedVariant(ds, 'v_a', 10);
    await seedVariant(ds, 'v_b', 1); // needs 2
    await seedOrder();
    await bundles.create('v_set', [
      { variantId: 'v_a', quantity: 3 },
      { variantId: 'v_b', quantity: 1 },
    ]);
    await orderRecords.freezeLineExpansion(ORDER_ID, {
      v: 1,
      definitions: await bundles.findCurrentByVariantIds(['v_set']),
    });
    const physical = (await orderRecords.getOrderRecord(ORDER_ID))!.physicalItems;

    const attempt = reservations.reserveForOrder({
      orderRecordId: ORDER_ID,
      atpEffect: 'published',
      lines: physical.map((i) => ({
        orderLineId: i.id,
        productId: i.productId,
        productVariantId: i.variantId ?? null,
        quantity: i.quantity,
      })),
    });
    await expect(attempt).rejects.toBeInstanceOf(InsufficientAvailabilityError);
    await expect(attempt).rejects.toMatchObject({ orderLineId: 'line-1~c:v_b' });

    const held = await ds.query<unknown[]>(
      `SELECT 1 FROM "reservations" WHERE "orderRecordId" = $1`,
      [ORDER_ID]
    );
    expect(held).toHaveLength(0);
  });

  it('should count open orders by frozen version through the containment predicate (#3520)', async () => {
    const ds = harness.getDataSource();
    await seedVariant(ds, 'v_set', null);
    await seedVariant(ds, 'v_a', 10);
    await seedOrder();
    await bundles.create('v_set', [{ variantId: 'v_a', quantity: 1 }]);
    await orderRecords.freezeLineExpansion(ORDER_ID, {
      v: 1,
      definitions: await bundles.findCurrentByVariantIds(['v_set']),
    });

    expect(await orderRecords.countOpenOrdersByBundleVersion('v_set')).toEqual([{ version: 1, count: 1 }]);
    expect(await orderRecords.countOpenOrdersByBundleVersion('v_other')).toEqual([]);
  });

  it('should select the multipack-held orders of ONE variant in SQL and report the scan (#3520)', async () => {
    const app = harness.getApp();
    const repo = harness.getDataSource().getRepository(OrderRecordOrmEntity);
    const source = (await createTestConnection(harness.getDataSource(), { platformType: 'allegro', adapterKey: 'allegro.publicapi.v1' })).id;
    const heldOrder = (id: string, offerId: string, reason: string): Partial<OrderRecordOrmEntity> => ({
      internalOrderId: id,
      customerId: null,
      sourceConnectionId: source,
      sourceEventId: null,
      orderSnapshot: {
        items: [{ id: 'l1', packQuantity: 3, productRef: { type: 'offer', externalId: offerId } }],
      },
      syncStatus: [],
      recordStatus: 'awaiting_mapping',
      mappingFailureReason: reason,
      cancelledAt: null,
    });
    await repo.save([
      repo.create(heldOrder('ol_order_h1', 'offer-1', 'sells 3 [multipack-without-bundle]')),
      repo.create(heldOrder('ol_order_h2', 'offer-2', 'sells 3 [multipack-without-bundle]')),
      repo.create(heldOrder('ol_order_h3', 'offer-1', 'identifier_mappings:Offer')),
    ]);
    const mapping = app.get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN);
    await mapping.createMapping(CORE_ENTITY_TYPE.Offer, 'offer-1', source, 'v_one');
    await mapping.createMapping(CORE_ENTITY_TYPE.Offer, 'offer-2', source, 'v_two');

    const resume = app.get<IOrderProvisioningResumeService>(ORDER_PROVISIONING_RESUME_SERVICE_TOKEN);
    const result = await resume.resumeMultipackHeldOrders({ variantId: 'v_one', packQuantity: 3 });

    // Only h1: h2 is another variant's offer, h3 is held for another reason.
    expect(result).toMatchObject({ held: 1, truncated: false, scanFailed: false });
  });
});
