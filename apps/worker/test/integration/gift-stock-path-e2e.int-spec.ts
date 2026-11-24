/**
 * Gift stock path, ingestion to decrement to cancellation give-back (#3939)
 *
 * The OMS-on half of the gift stock path against real Postgres: a promotion adds
 * a line at ingestion (#3938), the line is reserved like any other, the REAL
 * `InventorySaleDecrementHandler` lowers it in the owning master, and the stock
 * movement ledger records that decrement as `gift` (the paid line stays `sale`).
 * A cancellation then gives both units back through the same decrement rows.
 * Only the product master adapter is faked; the live Allegro-to-PrestaShop run
 * belongs to the E2E stage.
 *
 * @module apps/worker/test/integration
 */
import type { DataSource } from 'typeorm';

import type { IFulfillmentWorkQueryService } from '@openlinker/core/fulfillment';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import {
  INVENTORY_REPOSITORY_TOKEN,
  INVENTORY_SALE_DECREMENT_REPOSITORY_TOKEN,
  INVENTORY_SERVICE_TOKEN,
  InventorySaleDecrementService,
  InventorySaleReversalService,
  RESERVATION_SERVICE_TOKEN,
  type IInventoryService,
  type IReservationService,
  type InventoryAdjustmentResult,
} from '@openlinker/core/inventory';
import { InventoryItemOrmEntity } from '@openlinker/core/inventory/orm-entities';
import {
  ORDER_GIFT_SERVICE_TOKEN,
  ORDER_RECORD_REPOSITORY_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
  OrderRecord,
  applyOrderEditsToOrder,
  type IOrderGiftService,
  type IOrderRecordService,
  type Order,
} from '@openlinker/core/orders';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';
import { PROMOTION_SERVICE_TOKEN, type IPromotionService } from '@openlinker/core/promotions';
import {
  SYNC_JOB_QUEUE_TOKEN,
  SYNC_LOCK_TOKEN,
  type SyncJob,
  type SyncJobQueuePort,
  type SyncLockPort,
} from '@openlinker/core/sync';

import { InventorySaleDecrementHandler } from '../../src/sync/handlers/inventory-sale-decrement.handler';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { WorkerIntegrationTestHarness } from './setup';

const SHOP = '11111111-1111-4111-8111-111111111111';
const ALLEGRO = '22222222-2222-4222-8222-222222222222';
const ORDER_ID = 'ol_order_gift_stock';

interface OrdersRepository {
  upsertWithLineItems(record: OrderRecord, lineItems: never[]): Promise<OrderRecord>;
}

async function seedVariant(dataSource: DataSource, id: string, available: number): Promise<void> {
  const products = dataSource.getRepository(ProductOrmEntity);
  await products.save(products.create({ id: `p_${id}`, name: id, sku: null, price: null }));
  const variants = dataSource.getRepository(ProductVariantOrmEntity);
  await variants.save(
    variants.create({ id, productId: `p_${id}`, sku: null, attributes: null, ean: null, gtin: null })
  );
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

describe('Gift stock path, OMS on (#3939)', () => {
  let harness: WorkerIntegrationTestHarness;
  let adjustInventory: jest.Mock;

  beforeAll(async () => {
    process.env.OL_PII_HASH_SALT ??= 'test-salt-for-integration-tests';
    harness = await getTestHarness();
  }, 180000);

  afterAll(async () => {
    await teardownTestHarness();
  });

  beforeEach(async () => {
    await resetTestHarness();
  });

  afterEach(() => jest.restoreAllMocks());

  async function movements(): Promise<{ reason: string; variant: string; delta: number }[]> {
    return harness.getDataSource().query(
      `SELECT "reason" AS reason, "productVariantId" AS variant, "quantityDelta" AS delta
         FROM "inventory_movements"
        WHERE "status" = 'applied'
        ORDER BY "occurredAt", "productVariantId"`
    );
  }

  it('should record the gift decrement as gift, keep the paid line as sale, and give both back on cancellation', async () => {
    const ds = harness.getDataSource();
    await seedVariant(ds, 'v_book', 10);
    await seedVariant(ds, 'v_mug', 5);

    await harness.get<IPromotionService>(PROMOTION_SERVICE_TOKEN).create({
      name: 'Free mug with a book',
      conditions: [{ field: 'containsProduct', op: 'eq', value: 'v_book' }],
      benefit: {
        kind: 'free-gift',
        productId: 'p_v_mug',
        variantId: 'v_mug',
        quantity: 1,
        perUnit: null,
        skipIfPresent: true,
        documentForm: 'technical-cent',
      },
      isActive: true,
      effectiveFrom: new Date(Date.now() - 24 * 3600 * 1000),
      effectiveTo: null,
    });

    // Ingestion: persist the channel order, then let the promotion add its line.
    const placed = new Date(Date.now() + 60_000);
    const channel = {
      id: ORDER_ID,
      status: 'pending',
      placedAt: placed,
      items: [{ id: 'l1', productId: 'p_v_book', variantId: 'v_book', quantity: 1, price: 100 }],
      totals: { subtotal: 100, tax: 0, shipping: 0, total: 100, currency: 'PLN' },
    } as unknown as Order;
    const now = new Date();
    const persisted = await harness
      .get<OrdersRepository>(ORDER_RECORD_REPOSITORY_TOKEN)
      .upsertWithLineItems(
        new OrderRecord(
          ORDER_ID,
          null,
          ALLEGRO,
          null,
          channel as unknown as Record<string, unknown>,
          [],
          'ready',
          now,
          now
        ),
        []
      );
    await harness.get<IOrderGiftService>(ORDER_GIFT_SERVICE_TOKEN).applyGiftRules({
      order: applyOrderEditsToOrder(channel, persisted.orderEdits),
      channelOrder: channel,
      edits: persisted.orderEdits,
      customerId: 'cust-1',
      sourceConnectionId: ALLEGRO,
      occurredAt: placed,
      isFirstIngestion: persisted.orderEdits === null,
      allowNewGrants: true,
    });

    const orderRecords = harness.get<IOrderRecordService>(ORDER_RECORD_SERVICE_TOKEN);
    const record = await orderRecords.getOrderRecord(ORDER_ID);
    expect(record).not.toBeNull();
    const physical = record!.physicalItems;
    expect(physical.map((item) => [item.variantId, item.gift?.source])).toEqual([
      ['v_book', undefined],
      ['v_mug', 'ol-rule'],
    ]);

    // Reserved like any line (the gift is a line of the order when stock is held).
    await harness.get<IReservationService>(RESERVATION_SERVICE_TOKEN).reserveForOrder({
      orderRecordId: ORDER_ID,
      atpEffect: 'published',
      lines: physical.map((item) => ({
        orderLineId: item.id,
        productId: item.productId,
        productVariantId: item.variantId ?? null,
        quantity: item.quantity,
      })),
    });

    // The master answers with the stock it now holds, so the mirror moves.
    const stock: Record<string, number> = { v_book: 10, v_mug: 5 };
    adjustInventory = jest.fn((cmd: { variantId?: string; quantity: number }) => {
      const key = cmd.variantId ?? '';
      stock[key] = (stock[key] ?? 0) + cmd.quantity;
      return Promise.resolve({
        id: 'master',
        productId: 'x',
        quantity: stock[key],
        reserved: 0,
        available: stock[key],
        adjustmentOutcome: { disposition: 'applied', idempotency: 'unsupported', appliedAt: null },
      } satisfies InventoryAdjustmentResult);
    });
    const integrations = {
      getCapabilityAdapter: jest.fn(() =>
        Promise.resolve({ adjustInventory, listInventory: jest.fn(() => Promise.resolve([])) })
      ),
    } as unknown as IIntegrationsService;
    jest.spyOn(harness.get<SyncJobQueuePort>(SYNC_JOB_QUEUE_TOKEN), 'enqueue').mockResolvedValue('job');

    type Deps = ConstructorParameters<typeof InventorySaleDecrementService>;
    const decrements = new InventorySaleDecrementService(
      harness.get<Deps[0]>(INVENTORY_REPOSITORY_TOKEN),
      harness.get<Deps[1]>(INVENTORY_SALE_DECREMENT_REPOSITORY_TOKEN),
      harness.get<IInventoryService>(INVENTORY_SERVICE_TOKEN),
      integrations,
      harness.get<SyncLockPort>(SYNC_LOCK_TOKEN),
      harness.get<IReservationService>(RESERVATION_SERVICE_TOKEN)
    );
    const works = {
      findWorkById: jest.fn(() =>
        Promise.resolve({
          id: 'ol_work_gift',
          orderId: ORDER_ID,
          locationId: null,
          lines: physical.map((item) => ({
            orderLineId: item.id,
            totalQuantity: item.quantity,
            cancelledQuantity: 0,
            productVariantId: item.variantId ?? item.productId,
          })),
        })
      ),
    } as unknown as IFulfillmentWorkQueryService;

    const handler = new InventorySaleDecrementHandler(decrements, works, orderRecords);
    const result = await handler.execute({
      id: 'job-1',
      payload: { schemaVersion: 1, workId: 'ol_work_gift', orderId: ORDER_ID },
    } as unknown as SyncJob);
    expect(result.outcome).toBe('ok');

    expect(adjustInventory).toHaveBeenCalledWith(
      expect.objectContaining({ variantId: 'v_mug', quantity: -1 })
    );
    expect(await movements()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'sale', variant: 'v_book', delta: -1 }),
        expect.objectContaining({ reason: 'gift', variant: 'v_mug', delta: -1 }),
      ])
    );

    // Cancellation: the reversal is driven by the decrement rows, so the gift
    // goes back with the paid line.
    const reversal = new InventorySaleReversalService(
      harness.get(INVENTORY_REPOSITORY_TOKEN),
      harness.get(INVENTORY_SALE_DECREMENT_REPOSITORY_TOKEN),
      harness.get<IInventoryService>(INVENTORY_SERVICE_TOKEN),
      integrations
    );
    const reversed = await reversal.reverseForOrder(ORDER_ID);
    expect(reversed.lines).toHaveLength(2);
    expect(reversed.lines.every((line) => line.status === 'applied')).toBe(true);
    expect(stock).toEqual({ v_book: 10, v_mug: 5 });
    const restored = await movements();
    expect(restored.filter((row) => row.reason === 'cancellation_restore')).toHaveLength(2);
  });
});
