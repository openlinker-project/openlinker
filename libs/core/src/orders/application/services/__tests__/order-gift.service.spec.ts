import {
  Promotion,
  type ApplyPromotionsInput,
  type PreviewPromotionsInput,
  type PromotionLineGrant,
} from '@openlinker/core/promotions';

import {
  olGiftLineKey,
  applyOrderEditsToOrder,
  readOrderEdits,
  type ApplyOrderEditInput,
} from '../../../domain/types/order-edits.types';
import type { Order } from '../../../domain/types/order.types';
import { OrderGiftService } from '../order-gift.service';

const CREATED = new Date('2026-11-01T00:00:00.000Z');
const PLACED = new Date('2026-11-02T10:00:00.000Z');

function makePromotion(): Promotion {
  return new Promotion(
    'promo-1',
    'Free mug',
    true,
    1,
    CREATED,
    null,
    [{ field: 'containsProduct', op: 'eq', value: 'p-book' }],
    {
      kind: 'free-gift',
      productId: 'p-gift',
      variantId: 'v-gift',
      quantity: 1,
      perUnit: null,
      skipIfPresent: true,
      documentForm: 'technical-cent',
    },
    true,
    { unitCap: null, customerLimit: null },
    'hash',
    CREATED,
    CREATED
  );
}

function lineGrant(overrides: Partial<PromotionLineGrant> = {}): PromotionLineGrant {
  return {
    promotion: makePromotion(),
    productId: 'p-gift',
    variantId: 'v-gift',
    documentForm: 'technical-cent',
    quantity: 1,
    origin: 'new',
    ...overrides,
  };
}

function makeOrder(status: Order['status'] = 'pending'): Order {
  return {
    id: 'ol_order_1',
    status,
    placedAt: PLACED,
    items: [{ id: 'l1', productId: 'p-book', variantId: 'v-book', quantity: 1, price: 100 }],
    totals: { subtotal: 100, tax: 0, shipping: 0, total: 100, currency: 'PLN' },
  } as unknown as Order;
}

describe('OrderGiftService', () => {
  let promotions: Record<string, jest.Mock>;
  let availability: { getPromisableQuantities: jest.Mock };
  let orderRecords: { applyOrderEdit: jest.Mock };
  let products: { getEffectiveTaxRate: jest.Mock; getVariantsByIds: jest.Mock };
  let bundles: { findCurrentByVariantIds: jest.Mock; findConfirmedMultipacks: jest.Mock };
  let service: OrderGiftService;

  const written = (key: string) =>
    ({
      orderEdits: readOrderEdits({
        v: 1,
        rev: 1,
        addedLines: {
          [key]: {
            changeId: 'promo-1',
            editedAt: PLACED.toISOString(),
            editedBy: null,
            productId: 'p-gift',
            variantId: 'v-gift',
            quantity: 1,
            gift: { source: 'ol-rule', ruleRef: 'promo-1', documentForm: 'technical-cent' },
          },
        },
      }),
    }) as never;

  beforeEach(() => {
    promotions = {
      apply: jest.fn().mockResolvedValue({
        outcomes: [{ promotionId: 'promo-1', applied: true, alreadyApplied: false, quantity: 1 }],
        lineGrants: [lineGrant()],
        promotions: [makePromotion()],
      }),
      preview: jest.fn().mockResolvedValue({ evaluatedAt: PLACED, evaluations: [], outcomes: [] }),
      recordFailure: jest.fn().mockResolvedValue(undefined),
      releaseForOrder: jest.fn().mockResolvedValue(1),
    };
    availability = {
      getPromisableQuantities: jest
        .fn()
        .mockResolvedValue([{ productVariantId: 'v-gift', quantity: 10, provenance: 'computed' }]),
    };
    orderRecords = {
      applyOrderEdit: jest.fn().mockResolvedValue(written(olGiftLineKey('promo-1', '1'))),
    };
    products = {
      getVariantsByIds: jest.fn().mockResolvedValue([
        {
          id: 'v-gift',
          netUnitCost: '3.5000',
          costCurrency: 'PLN',
          costUpdatedAt: new Date('2025-12-01T00:00:00Z'),
        },
      ]),
      getEffectiveTaxRate: jest
        .fn()
        .mockResolvedValue({ code: '23', countryIso2: 'PL', readAt: new Date('2026-01-01T00:00:00Z') }),
    };
    bundles = {
      findCurrentByVariantIds: jest.fn().mockResolvedValue([]),
      findConfirmedMultipacks: jest.fn().mockResolvedValue([]),
    };
    service = new OrderGiftService(
      promotions as never,
      availability as never,
      orderRecords as never,
      products as never,
      bundles as never
    );
  });

  const applyInput = (): ApplyPromotionsInput =>
    (promotions.apply.mock.calls as [ApplyPromotionsInput][])[0][0];
  const previewInput = (): PreviewPromotionsInput =>
    (promotions.preview.mock.calls as [PreviewPromotionsInput][])[0][0];

  const apply = (order: Order, edits = null as never, extra: object = {}) =>
    service.applyGiftRules({
      order,
      channelOrder: order,
      edits,
      customerId: 'cust-1',
      sourceConnectionId: 'c1',
      occurredAt: PLACED,
      isFirstIngestion: true,
      allowNewGrants: true,
      ...extra,
    });

  it('should write the granted gift into the overlay, stamp the form, and return the order with the gift line', async () => {
    const result = await apply(makeOrder());

    const call = (orderRecords.applyOrderEdit.mock.calls as [ApplyOrderEditInput][])[0][0];
    expect(call.expectedRev).toBeNull();
    expect(call.addedLines?.[olGiftLineKey('promo-1', '1')]).toMatchObject({
      productId: 'p-gift',
      quantity: 1,
      name: 'Free mug',
      gift: { source: 'ol-rule', ruleRef: 'promo-1', documentForm: 'technical-cent' },
    });
    expect(result.order.items).toHaveLength(2);
    expect(result.order.items[1]).toMatchObject({ price: 0, gift: { source: 'ol-rule' } });
  });

  it('should project the order onto facts and tell the planner which gift lines are already present', async () => {
    const key = olGiftLineKey('promo-1', '1');
    const edits = readOrderEdits({
      v: 1,
      rev: 1,
      addedLines: {
        [key]: {
          changeId: 'promo-1',
          editedAt: PLACED.toISOString(),
          editedBy: null,
          productId: 'p-gift',
          quantity: 1,
          gift: { source: 'ol-rule' },
        },
      },
    });
    promotions.apply.mockResolvedValue({ outcomes: [], lineGrants: [], promotions: [makePromotion()] });

    await apply(makeOrder(), edits as never);

    const input = applyInput();
    expect([...input.presentPromotionIds]).toEqual(['promo-1']);
    expect(input.facts).toMatchObject({
      orderId: 'ol_order_1',
      sourceConnectionId: 'c1',
      totalGross: 100,
      currency: 'PLN',
      lineProductIds: ['p-book'],
    });
    expect(input.customerId).toBe('cust-1');
    expect(orderRecords.applyOrderEdit).not.toHaveBeenCalled();
  });

  it('should hand the planner a stock reader that maps the availability read and never reads unknown as zero', async () => {
    availability.getPromisableQuantities.mockResolvedValue([
      { productVariantId: 'v-gift', quantity: 4, provenance: 'computed' },
      { productVariantId: 'v-other', quantity: null, provenance: 'unknown' },
    ]);
    await apply(makeOrder());

    const answers = await applyInput().readStock(['v-gift', 'v-other']);
    expect(answers.get('v-gift')).toEqual({ kind: 'known', available: 4 });
    expect(answers.get('v-other')).toEqual({ kind: 'unknown' });
  });

  const setDefinition = (componentProductId: string, giftSlot = false) => ({
    variantId: 'v-book',
    components: [
      {
        productId: componentProductId,
        variantId: `v-${componentProductId}`,
        quantity: 1,
        ...(giftSlot && { giftSlot: true }),
      },
    ],
  });

  it('should pass the physical component product ids of a set in the order (#3945)', async () => {
    bundles.findCurrentByVariantIds.mockResolvedValue([setDefinition('p-gift')]);

    await apply(makeOrder());

    expect([...(applyInput().componentProductIds ?? [])]).toEqual(['p-gift']);
  });

  it('should read the frozen definitions and not the live ones on a re-ingestion (#3945)', async () => {
    const frozen = [setDefinition('p-gift')] as never;

    await apply(makeOrder(), null as never, { frozenDefinitions: frozen });

    expect(bundles.findCurrentByVariantIds).not.toHaveBeenCalled();
    expect([...(applyInput().componentProductIds ?? [])]).toEqual(['p-gift']);
  });

  it('should stamp the catalogue tax rate on the overlay entry, and read back onto the order item (#3939)', async () => {
    await apply(makeOrder());

    const call = (orderRecords.applyOrderEdit.mock.calls as [ApplyOrderEditInput][])[0][0];
    const entry = call.addedLines?.[olGiftLineKey('promo-1', '1')];
    expect(entry).toMatchObject({ taxRate: '23', taxRateCountry: 'PL', taxSource: 'shop' });

    const edits = readOrderEdits(JSON.parse(JSON.stringify({ v: 1, rev: 1, addedLines: call.addedLines })));
    const item = applyOrderEditsToOrder(makeOrder(), edits).items.find((i) => i.gift !== undefined);
    expect(item).toMatchObject({ taxRate: '23', taxRateCountry: 'PL', taxSource: 'shop', price: 0 });
  });

  it('should freeze the gift cost on the entry when it was recorded before the order was placed (ADR-080)', async () => {
    await apply(makeOrder());

    const call = (orderRecords.applyOrderEdit.mock.calls as [ApplyOrderEditInput][])[0][0];
    expect(call.addedLines?.[olGiftLineKey('promo-1', '1')]).toMatchObject({
      unitCostNet: '3.5000',
      unitCostCurrency: 'PLN',
    });
  });

  it('should freeze no cost when it was entered after the order was placed, and never 0', async () => {
    products.getVariantsByIds.mockResolvedValue([
      {
        id: 'v-gift',
        netUnitCost: '3.5000',
        costCurrency: 'PLN',
        costUpdatedAt: new Date(PLACED.getTime() + 60_000),
      },
    ]);

    await apply(makeOrder());

    const call = (orderRecords.applyOrderEdit.mock.calls as [ApplyOrderEditInput][])[0][0];
    expect(call.addedLines?.[olGiftLineKey('promo-1', '1')]).not.toHaveProperty('unitCostNet');
  });

  it('should leave the entry without a rate when the catalogue has no answer', async () => {
    products.getEffectiveTaxRate.mockResolvedValue({ code: null, countryIso2: null, readAt: null });

    await apply(makeOrder());

    const call = (orderRecords.applyOrderEdit.mock.calls as [ApplyOrderEditInput][])[0][0];
    expect(call.addedLines?.[olGiftLineKey('promo-1', '1')]).not.toHaveProperty('taxRate');
  });

  it('should re-add a missing line from the grant, not from the promotion', async () => {
    promotions.apply.mockResolvedValue({
      outcomes: [],
      lineGrants: [
        lineGrant({ origin: 'self-heal', quantity: 3, productId: 'p-old', variantId: 'v-old', documentForm: null }),
      ],
      promotions: [makePromotion()],
    });

    await apply(makeOrder());

    const call = (orderRecords.applyOrderEdit.mock.calls as [ApplyOrderEditInput][])[0][0];
    expect(call.addedLines?.[olGiftLineKey('promo-1', '1')]).toMatchObject({
      quantity: 3,
      productId: 'p-old',
      variantId: 'v-old',
    });
    expect(call.addedLines?.[olGiftLineKey('promo-1', '1')].gift).not.toHaveProperty('documentForm');
  });

  it.each([
    ['custom-price', '4.50', { documentForm: 'custom-price', documentUnitPrice: '4.50' }],
    ['omit', '9', { documentForm: 'omit' }],
  ])('should carry the amount only for custom-price (%s)', async (form, amount, expected) => {
    promotions.apply.mockResolvedValue({
      outcomes: [],
      lineGrants: [lineGrant({ documentForm: form, documentUnitPrice: amount })],
      promotions: [makePromotion()],
    });

    await apply(makeOrder());

    const call = (orderRecords.applyOrderEdit.mock.calls as [ApplyOrderEditInput][])[0][0];
    const gift = call.addedLines?.[olGiftLineKey('promo-1', '1')].gift;
    expect(gift).toMatchObject(expected);
    if (form !== 'custom-price') expect(gift).not.toHaveProperty('documentUnitPrice');
  });

  it('should add nothing once the order is past routing or mirroring', async () => {
    const result = await apply(makeOrder(), null as never, { allowNewGrants: false });

    expect(promotions.apply).not.toHaveBeenCalled();
    expect(orderRecords.applyOrderEdit).not.toHaveBeenCalled();
    expect(result.order.items).toHaveLength(1);
    expect(result.outcomes).toEqual([]);
  });

  it('should add nothing to an order known cancelled while its status still lags', async () => {
    const result = await apply(makeOrder('pending'), null as never, { cancelled: true });

    expect(promotions.apply).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([]);
  });

  it('should add nothing to a cancelled order', async () => {
    const result = await apply(makeOrder('cancelled'));
    expect(promotions.apply).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([]);
  });

  it('should release the grants of a cancelled order', async () => {
    await service.releaseGrantsForCancelledOrder('ol_order_1');

    expect(promotions.releaseForOrder).toHaveBeenCalledWith('ol_order_1');
  });

  it('should not throw when releasing the grants fails', async () => {
    promotions.releaseForOrder.mockRejectedValue(new Error('db down'));

    await expect(service.releaseGrantsForCancelledOrder('ol_order_1')).resolves.toBeUndefined();
  });

  it('should keep the order flowing but record a failure naming the promotion and order when writing fails', async () => {
    orderRecords.applyOrderEdit.mockRejectedValue(new Error('db down'));
    const order = makeOrder();
    const result = await apply(order);

    expect(result.order).toBe(order);
    expect(promotions.recordFailure).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'promo-1' })],
      'ol_order_1',
      expect.stringContaining('ol_order_1')
    );
  });

  it('should continue the order without a gift when the promotions cannot be applied', async () => {
    promotions.apply.mockRejectedValue(new Error('db down'));
    const order = makeOrder();
    const result = await apply(order);
    expect(result.order).toBe(order);
    expect(promotions.recordFailure).toHaveBeenCalledWith([], 'ol_order_1', expect.any(String));
  });

  it('should preview through the planner without writing anything', async () => {
    const record = {
      internalOrderId: 'ol_order_1',
      sourceConnectionId: 'c1',
      recordStatus: 'ready',
      placedAt: new Date('2026-10-01T00:00:00.000Z'),
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      customerId: 'cust-1',
      totalAmount: 100,
      currency: 'PLN',
      orderSnapshot: {},
      orderItems: makeOrder().items,
    };
    await service.previewForOrder({ record: record as never });

    const input = previewInput();
    expect(input.facts).toMatchObject({ orderId: 'ol_order_1', totalGross: 100, currency: 'PLN' });
    expect(orderRecords.applyOrderEdit).not.toHaveBeenCalled();
  });
});
