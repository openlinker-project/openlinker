/**
 * Gift rules at ingestion (integration, #3938)
 *
 * Against a real database, because the guarantees that matter are database facts:
 * the grant ledger's unique `(rule, order)` pair is what stops a re-ingestion
 * giving twice, the overlay's insert-if-absent merge is what keeps an existing
 * gift line untouched, and the unit cap is summed over the ledger. Stock is the
 * real availability seam over seeded inventory; nothing is faked.
 *
 * @module apps/api/test/integration
 */
import type { DataSource } from 'typeorm';

import {
  AUTOMATION_RULES_SERVICE_TOKEN,
  GIFT_RULE_SERVICE_TOKEN,
  type AutomationGiftAction,
  type IAutomationRulesService,
  type IGiftRuleService,
} from '@openlinker/core/automation';
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
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';

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

describe('Gift rules at ingestion (integration, #3938)', () => {
  let harness: IntegrationTestHarness;
  let rules: IAutomationRulesService;
  let gifts: IGiftRuleService;
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
    rules = app.get<IAutomationRulesService>(AUTOMATION_RULES_SERVICE_TOKEN);
    gifts = app.get<IGiftRuleService>(GIFT_RULE_SERVICE_TOKEN);
    orderGifts = app.get<IOrderGiftService>(ORDER_GIFT_SERVICE_TOKEN);
    orders = app.get<OrdersRepository>(ORDER_RECORD_REPOSITORY_TOKEN);
    const ds = harness.getDataSource();
    await seedVariant(ds, 'v_book', 10);
    await seedVariant(ds, 'v_mug', 2);
  });

  const giftAction = (overrides: Partial<AutomationGiftAction> = {}): AutomationGiftAction => ({
    action: 'add-gift',
    productId: 'p_v_mug',
    variantId: 'v_mug',
    quantity: 1,
    perUnit: null,
    unitCap: null,
    skipIfPresent: true,
    doNotCombine: false,
    customerLimit: null,
    documentForm: 'technical-cent',
    ...overrides,
  });

  async function createRule(overrides: Partial<AutomationGiftAction> = {}): Promise<string> {
    const rule = await rules.createRule({
      name: 'Free mug with a book',
      trigger: 'order.ingested',
      triggerConfig: {},
      conditions: [{ field: 'containsProduct', op: 'eq', value: 'v_book' }],
      actions: [giftAction(overrides)],
      isActive: true,
      effectiveFrom: new Date(Date.now() - 24 * 3600 * 1000),
      effectiveTo: null,
    });
    return rule.id;
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
    });
  }

  it('should add the gift line to a matching order, stamped as an OpenLinker rule gift with its form', async () => {
    const ruleId = await createRule();
    const placed = new Date(Date.now() + 60_000);

    const result = await ingest(channelOrder(placed), placed);

    expect(result.order.items).toHaveLength(2);
    expect(result.order.items[1]).toMatchObject({
      id: olGiftLineKey(ruleId, '1'),
      productId: 'p_v_mug',
      variantId: 'v_mug',
      quantity: 1,
      price: 0,
      gift: { source: 'ol-rule', ruleRef: ruleId, documentForm: 'technical-cent' },
    });

    // Persisted in the overlay: a fresh read sees the gift in the effective snapshot
    // while the channel snapshot stays the channel's own.
    const record = (await orders.findById(ORDER_ID)) as OrderRecord;
    expect(record.orderItems).toHaveLength(2);
    expect((record.channelSnapshot.items as unknown[]).length).toBe(1);
    expect(record.isEditedInOpenLinker).toBe(false);
  });

  it('should add nothing twice on re-ingestion, and keep counting the gift once', async () => {
    const ruleId = await createRule();
    const placed = new Date(Date.now() + 60_000);

    await ingest(channelOrder(placed), placed);
    const second = await ingest(channelOrder(placed), placed);
    const third = await ingest(channelOrder(placed), placed);

    expect(second.order.items).toHaveLength(2);
    expect(third.order.items).toHaveLength(2);
    expect(second.outcomes[0]).toMatchObject({ applied: true, alreadyApplied: true });
    const [view] = await gifts.listGiftRules();
    expect(view.unitsGiven).toBe(1);
    expect(view.rule.id).toBe(ruleId);
  });

  it('should give an order placed before the rule was saved nothing', async () => {
    await createRule();
    const placedBefore = new Date(Date.now() - 48 * 3600 * 1000);

    const result = await ingest(channelOrder(placedBefore), placedBefore);

    expect(result.order.items).toHaveLength(1);
    expect(result.outcomes[0]).toMatchObject({
      applied: false,
      reason: 'rule-not-matching',
      nonFiringReason: 'fact-precedes-rule',
    });
  });

  it('should pause the rule at its unit cap and resume only on an explicit resume', async () => {
    const ruleId = await createRule({ unitCap: 1 });
    const placed = new Date(Date.now() + 60_000);

    await ingest(channelOrder(placed), placed);
    const [paused] = await gifts.listGiftRules();
    expect(paused.state?.pausedReason).toBe('unit-cap');
    expect(paused.effectiveCap).toBe(1);

    const secondOrder = { ...channelOrder(placed), id: 'ol_order_gift_2' } as Order;
    const refused = await ingest(secondOrder, placed);
    expect(refused.order.items).toHaveLength(1);
    expect(refused.outcomes[0].reason).toBe('paused-unit-cap');

    const resumed = await gifts.resumeAfterCap(ruleId, 2);
    expect(resumed.state?.pausedReason).toBeNull();
    expect(resumed.effectiveCap).toBe(3);
    const thirdOrder = { ...channelOrder(placed), id: 'ol_order_gift_3' } as Order;
    expect((await ingest(thirdOrder, placed)).order.items).toHaveLength(2);
  });

  it('should pause for stock and resume by itself when stock returns', async () => {
    const ruleId = await createRule({ quantity: 3 });
    const placed = new Date(Date.now() + 60_000);

    const out = await ingest(channelOrder(placed), placed);
    expect(out.order.items).toHaveLength(1);
    expect(out.outcomes[0].reason).toBe('gift-out-of-stock');
    expect((await gifts.listGiftRules())[0].state?.pausedReason).toBe('gift-out-of-stock');

    await harness
      .getDataSource()
      .getRepository(InventoryItemOrmEntity)
      .update({ productVariantId: 'v_mug' }, { availableQuantity: 5 });
    const orderTwo = { ...channelOrder(placed), id: 'ol_order_gift_2' } as Order;
    const back = await ingest(orderTwo, placed);
    expect(back.order.items).toHaveLength(2);
    expect((await gifts.listGiftRules())[0].state?.pausedReason).toBeNull();
    expect(ruleId).toBeDefined();
  });

  it('should apply only the first non-combinable rule in list order', async () => {
    const first = await createRule({ doNotCombine: true });
    await seedVariant(harness.getDataSource(), 'v_pen', 5);
    const second = (
      await rules.createRule({
        name: 'Free pen',
        trigger: 'order.ingested',
        triggerConfig: {},
        conditions: [{ field: 'containsProduct', op: 'eq', value: 'v_book' }],
        actions: [giftAction({ productId: 'p_v_pen', variantId: 'v_pen' })],
        isActive: true,
        effectiveFrom: new Date(Date.now() - 24 * 3600 * 1000),
        effectiveTo: null,
      })
    ).id;
    await rules.reorderRules('order.ingested', [first, second]);
    const placed = new Date(Date.now() + 60_000);

    const result = await ingest(channelOrder(placed), placed);

    expect(result.order.items).toHaveLength(2);
    expect(result.outcomes.map((o) => [o.ruleId, o.applied])).toEqual([
      [first, true],
      [second, false],
    ]);
    expect(result.outcomes[1].reason).toBe('superseded-by-earlier-rule');
  });

  it('should not overshoot the unit cap when two orders are ingested at the same instant', async () => {
    await createRule({ unitCap: 1 });
    const placed = new Date(Date.now() + 60_000);
    const orderA = { ...channelOrder(placed), id: 'ol_order_race_a' } as Order;
    const orderB = { ...channelOrder(placed), id: 'ol_order_race_b' } as Order;

    const [a, b] = await Promise.all([ingest(orderA, placed), ingest(orderB, placed)]);

    expect([a.order.items.length, b.order.items.length].sort()).toEqual([1, 2]);
    expect((await gifts.listGiftRules())[0].unitsGiven).toBe(1);
  });
});
