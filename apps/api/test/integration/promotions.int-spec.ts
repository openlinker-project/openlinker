/**
 * Promotions at ingestion (integration, #3938, moved to promotions in #3935)
 *
 * Against a real database, because the guarantees that matter are database facts:
 * the grant ledger's unique `(promotion, order)` pair is what stops a re-ingestion
 * giving twice, the overlay's insert-if-absent merge is what keeps an existing
 * gift line untouched, and the unit cap is summed over the ledger. Stock is the
 * real availability seam over seeded inventory; nothing is faked.
 *
 * @module apps/api/test/integration
 */
import type { DataSource } from 'typeorm';

import { InventoryItemOrmEntity } from '@openlinker/core/inventory/orm-entities';
import {
  ORDER_GIFT_SERVICE_TOKEN,
  ORDER_RECORD_REPOSITORY_TOKEN,
  applyOrderEditsToOrder,
  olGiftLineKey,
  type IOrderGiftService,
  type Order,
  OrderRecord,
} from '@openlinker/core/orders';
import { BUNDLE_DEFINITION_SERVICE_TOKEN, type IBundleDefinitionService } from '@openlinker/core/products';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';
import {
  PROMOTION_SERVICE_TOKEN,
  PromotionConflictError,
  PromotionReorderMismatchError,
  type FreeGiftBenefit,
  type IPromotionService,
} from '@openlinker/core/promotions';

import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';

const SHOP = '11111111-1111-4111-8111-111111111111';
const ALLEGRO = '22222222-2222-4222-8222-222222222222';
const ORDER_ID = 'ol_order_gift_1';

interface OrdersRepository {
  upsertWithLineItems(record: OrderRecord, lineItems: never[]): Promise<OrderRecord>;
  findById(id: string): Promise<OrderRecord | null>;
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

describe('Promotions at ingestion (integration, #3935)', () => {
  let harness: IntegrationTestHarness;
  let promotions: IPromotionService;
  let orderGifts: IOrderGiftService;
  let orders: OrdersRepository;

  beforeAll(async () => {
    harness = await getTestHarness();
  }, 180000);

  afterAll(async () => {
    await teardownTestHarness();
  });

  beforeEach(async () => {
    await resetTestHarness();
    const app = harness.getApp();
    promotions = app.get<IPromotionService>(PROMOTION_SERVICE_TOKEN);
    orderGifts = app.get<IOrderGiftService>(ORDER_GIFT_SERVICE_TOKEN);
    orders = app.get<OrdersRepository>(ORDER_RECORD_REPOSITORY_TOKEN);
    const ds = harness.getDataSource();
    await seedVariant(ds, 'v_book', 10);
    await seedVariant(ds, 'v_mug', 2);
  });

  interface PromotionOverrides extends Partial<Omit<FreeGiftBenefit, 'kind'>> {
    unitCap?: number | null;
    doNotCombine?: boolean;
    customerLimit?: number | null;
  }

  const benefitOf = (overrides: PromotionOverrides = {}): FreeGiftBenefit => ({
    kind: 'free-gift',
    productId: overrides.productId ?? 'p_v_mug',
    variantId: overrides.variantId ?? 'v_mug',
    quantity: overrides.quantity ?? 1,
    perUnit: overrides.perUnit ?? null,
    skipIfPresent: overrides.skipIfPresent ?? true,
    documentForm: overrides.documentForm ?? 'technical-cent',
  });

  async function createPromotion(
    overrides: PromotionOverrides = {},
    name = 'Free mug with a book'
  ): Promise<string> {
    const view = await promotions.create({
      name,
      conditions: [{ field: 'containsProduct', op: 'eq', value: 'v_book' }],
      benefit: benefitOf(overrides),
      combinable: !(overrides.doNotCombine ?? false),
      limits: { unitCap: overrides.unitCap ?? null, customerLimit: overrides.customerLimit ?? null },
      isActive: true,
      effectiveFrom: new Date(Date.now() - 24 * 3600 * 1000),
      effectiveTo: null,
    });
    return view.promotion.id;
  }

  const channelOrder = (placedAt: Date): Order =>
    ({
      id: ORDER_ID,
      status: 'pending',
      placedAt,
      items: [{ id: 'l1', productId: 'p_v_book', variantId: 'v_book', quantity: 1, price: 100 }],
      totals: { subtotal: 100, tax: 0, shipping: 0, total: 100, currency: 'PLN' },
    }) as unknown as Order;

  async function persist(order: Order): Promise<OrderRecord> {
    const now = new Date();
    return orders.upsertWithLineItems(
      new OrderRecord(
        order.id,
        null,
        ALLEGRO,
        null,
        order as unknown as Record<string, unknown>,
        [],
        'ready',
        now,
        now
      ),
      []
    );
  }

  /** One ingestion: persist the channel order (which hands back the overlay), then apply the gifts. */
  async function ingest(order: Order, occurredAt: Date, customerId: string | null = 'cust-1') {
    const persisted = await persist(order);
    return orderGifts.applyGiftRules({
      // As ingestion does: the order handed in already carries the committed overlay.
      order: applyOrderEditsToOrder(order, persisted.orderEdits),
      channelOrder: order,
      edits: persisted.orderEdits,
      customerId,
      sourceConnectionId: ALLEGRO,
      occurredAt,
      isFirstIngestion: persisted.orderEdits === null,
      allowNewGrants: true,
    });
  }

  it('should add the gift line to a matching order, stamped as an OpenLinker promotion gift with its form', async () => {
    const promotionId = await createPromotion();
    const placed = new Date(Date.now() + 60_000);

    const result = await ingest(channelOrder(placed), placed);

    expect(result.order.items).toHaveLength(2);
    expect(result.order.items[1]).toMatchObject({
      id: olGiftLineKey(promotionId, '1'),
      productId: 'p_v_mug',
      variantId: 'v_mug',
      quantity: 1,
      price: 0,
      gift: { source: 'ol-rule', ruleRef: promotionId, documentForm: 'technical-cent' },
    });

    // Persisted in the overlay: a fresh read sees the gift in the effective snapshot
    // while the channel snapshot stays the channel's own.
    const record = (await orders.findById(ORDER_ID)) as OrderRecord;
    expect(record.orderItems).toHaveLength(2);
    expect((record.channelSnapshot.items as unknown[]).length).toBe(1);
    expect(record.isEditedInOpenLinker).toBe(false);
  });

  it('should give no second gift to a buyer of a set that already contains it (#3945)', async () => {
    await createPromotion();
    await seedVariant(harness.getDataSource(), 'v_set', 0);
    await harness
      .getApp()
      .get<IBundleDefinitionService>(BUNDLE_DEFINITION_SERVICE_TOKEN)
      .create('v_set', [{ variantId: 'v_mug', quantity: 1 }]);
    const placed = new Date(Date.now() + 60_000);
    const base = channelOrder(placed);
    const order = {
      ...base,
      items: [
        ...base.items,
        { id: 'l2', productId: 'p_v_set', variantId: 'v_set', quantity: 1, price: 50 },
      ],
    } as unknown as Order;

    const result = await ingest(order, placed);

    expect(result.order.items).toHaveLength(2);
    expect(result.outcomes[0]).toMatchObject({ applied: false, reason: 'gift-already-in-order' });
  });

  it('should add nothing twice on re-ingestion, and keep counting the gift once', async () => {
    const promotionId = await createPromotion();
    const placed = new Date(Date.now() + 60_000);

    await ingest(channelOrder(placed), placed);
    const second = await ingest(channelOrder(placed), placed);
    const third = await ingest(channelOrder(placed), placed);

    expect(second.order.items).toHaveLength(2);
    expect(third.order.items).toHaveLength(2);
    expect(second.outcomes[0]).toMatchObject({ applied: true, alreadyApplied: true });
    const [view] = await promotions.list();
    expect(view.unitsGiven).toBe(1);
    expect(view.promotion.id).toBe(promotionId);
  });

  it('should give an order placed before the promotion was saved nothing', async () => {
    await createPromotion();
    const placedBefore = new Date(Date.now() - 48 * 3600 * 1000);

    const result = await ingest(channelOrder(placedBefore), placedBefore);

    expect(result.order.items).toHaveLength(1);
    expect(result.outcomes[0]).toMatchObject({
      applied: false,
      reason: 'rule-not-matching',
      nonFiringReason: 'fact-precedes-rule',
    });
  });

  it('should pause the promotion at its unit cap and resume only on an explicit resume', async () => {
    const promotionId = await createPromotion({ unitCap: 1 });
    const placed = new Date(Date.now() + 60_000);

    await ingest(channelOrder(placed), placed);
    const [paused] = await promotions.list();
    expect(paused.state?.pausedReason).toBe('unit-cap');
    expect(paused.effectiveCap).toBe(1);

    const secondOrder = { ...channelOrder(placed), id: 'ol_order_gift_2' } as Order;
    const refused = await ingest(secondOrder, placed);
    expect(refused.order.items).toHaveLength(1);
    expect(refused.outcomes[0].reason).toBe('paused-unit-cap');

    const resumed = await promotions.resumeAfterCap(promotionId, 2);
    expect(resumed.state?.pausedReason).toBeNull();
    expect(resumed.effectiveCap).toBe(3);
    const thirdOrder = { ...channelOrder(placed), id: 'ol_order_gift_3' } as Order;
    expect((await ingest(thirdOrder, placed)).order.items).toHaveLength(2);
  });

  it('should pause for stock and resume by itself when stock returns', async () => {
    const promotionId = await createPromotion({ quantity: 3 });
    const placed = new Date(Date.now() + 60_000);

    const out = await ingest(channelOrder(placed), placed);
    expect(out.order.items).toHaveLength(1);
    expect(out.outcomes[0].reason).toBe('gift-out-of-stock');
    expect((await promotions.list())[0].state?.pausedReason).toBe('gift-out-of-stock');

    await harness
      .getDataSource()
      .getRepository(InventoryItemOrmEntity)
      .update({ productVariantId: 'v_mug' }, { availableQuantity: 5 });
    const orderTwo = { ...channelOrder(placed), id: 'ol_order_gift_2' } as Order;
    const back = await ingest(orderTwo, placed);
    expect(back.order.items).toHaveLength(2);
    expect((await promotions.list())[0].state?.pausedReason).toBeNull();
    expect(promotionId).toBeDefined();
  });

  it('should apply only the first non-combinable promotion in list order', async () => {
    const first = await createPromotion({ doNotCombine: true });
    await seedVariant(harness.getDataSource(), 'v_pen', 5);
    const second = await createPromotion({ productId: 'p_v_pen', variantId: 'v_pen' }, 'Free pen');
    await promotions.reorder([first, second]);
    const placed = new Date(Date.now() + 60_000);

    const result = await ingest(channelOrder(placed), placed);

    expect(result.order.items).toHaveLength(2);
    expect(result.outcomes.map((o) => [o.promotionId, o.applied])).toEqual([
      [first, true],
      [second, false],
    ]);
    expect(result.outcomes[1].reason).toBe('superseded-by-earlier-rule');
  });

  it('should not overshoot the unit cap when two orders are ingested at the same instant', async () => {
    await createPromotion({ unitCap: 1 });
    const placed = new Date(Date.now() + 60_000);
    const orderA = { ...channelOrder(placed), id: 'ol_order_race_a' } as Order;
    const orderB = { ...channelOrder(placed), id: 'ol_order_race_b' } as Order;

    const [a, b] = await Promise.all([ingest(orderA, placed), ingest(orderB, placed)]);

    expect([a.order.items.length, b.order.items.length].sort()).toEqual([1, 2]);
    expect((await promotions.list())[0].unitsGiven).toBe(1);
  });

  it('should not give the last units twice when two orders are ingested before either has reserved', async () => {
    // v_mug has 2 units: the first order is granted both, the second must see
    // them as spoken for even though no reservation exists yet.
    await createPromotion({ quantity: 2 });
    const placed = new Date(Date.now() + 60_000);
    const orderA = { ...channelOrder(placed), id: 'ol_order_stock_a' } as Order;
    const orderB = { ...channelOrder(placed), id: 'ol_order_stock_b' } as Order;

    const [a, b] = await Promise.all([ingest(orderA, placed), ingest(orderB, placed)]);

    expect([a.order.items.length, b.order.items.length].sort()).toEqual([1, 2]);
    expect((await promotions.list())[0].unitsGiven).toBe(2);
  });

  it('should return the units to the promotion when the order is cancelled', async () => {
    await createPromotion({ unitCap: 1 });
    const placed = new Date(Date.now() + 60_000);
    await ingest(channelOrder(placed), placed);
    expect((await promotions.list())[0].unitsGiven).toBe(1);

    await orderGifts.releaseGrantsForCancelledOrder(ORDER_ID);

    expect((await promotions.list())[0].unitsGiven).toBe(0);
  });

  it('should add nothing to an order that is past routing, even though the promotion could apply now', async () => {
    await createPromotion();
    const placed = new Date(Date.now() + 60_000);
    const order = channelOrder(placed);
    const persisted = await persist(order);

    const result = await orderGifts.applyGiftRules({
      order: applyOrderEditsToOrder(order, persisted.orderEdits),
      channelOrder: order,
      edits: persisted.orderEdits,
      customerId: 'cust-1',
      sourceConnectionId: ALLEGRO,
      occurredAt: placed,
      isFirstIngestion: false,
      allowNewGrants: false,
    });

    expect(result.order.items).toHaveLength(1);
    expect((await promotions.list())[0].unitsGiven).toBe(0);
  });

  it('should refuse an identical definition on an overlapping window', async () => {
    const first = await createPromotion();
    expect(first).toBeDefined();

    await expect(createPromotion()).rejects.toBeInstanceOf(PromotionConflictError);
  });

  it('should refuse a partial reorder naming what is missing, and write nothing', async () => {
    const first = await createPromotion();
    await seedVariant(harness.getDataSource(), 'v_pen', 5);
    const second = await createPromotion({ productId: 'p_v_pen', variantId: 'v_pen' }, 'Free pen');

    await expect(promotions.reorder([second])).rejects.toBeInstanceOf(PromotionReorderMismatchError);

    expect((await promotions.list()).map((v) => v.promotion.id)).toEqual([first, second]);
  });

  it('should reorder exhaustively and keep every position dense', async () => {
    const first = await createPromotion();
    await seedVariant(harness.getDataSource(), 'v_pen', 5);
    const second = await createPromotion({ productId: 'p_v_pen', variantId: 'v_pen' }, 'Free pen');

    const reordered = await promotions.reorder([second, first]);

    expect(reordered.map((v) => [v.promotion.id, v.promotion.position])).toEqual([
      [second, 1],
      [first, 2],
    ]);
  });
});
