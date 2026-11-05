import { AutomationRule, type AutomationGiftAction } from '@openlinker/core/automation';

import {
  olGiftLineKey,
  applyOrderEditsToOrder,
  readOrderEdits,
  type ApplyOrderEditInput,
} from '../../../domain/types/order-edits.types';
import type { Order } from '../../../domain/types/order.types';
import { OrderGiftService } from '../order-gift.service';

const RULE_CREATED = new Date('2026-11-01T00:00:00.000Z');
const PLACED = new Date('2026-11-02T10:00:00.000Z');

const ACTION: AutomationGiftAction = {
  action: 'add-gift',
  productId: 'p-gift',
  variantId: 'v-gift',
  quantity: 1,
  perUnit: null,
  unitCap: null,
  skipIfPresent: true,
  doNotCombine: false,
  customerLimit: null,
  documentForm: 'technical-cent',
};

function makeRule(overrides: Partial<AutomationGiftAction> = {}, createdAt = RULE_CREATED): AutomationRule {
  return new AutomationRule(
    'rule-1',
    'Free mug',
    'order.ingested',
    {},
    [{ field: 'containsProduct', op: 'eq', value: 'p-book' }],
    [{ ...ACTION, ...overrides }],
    'hash',
    true,
    RULE_CREATED,
    null,
    null,
    null,
    createdAt,
    createdAt
  );
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
  let giftRules: Record<string, jest.Mock>;
  let availability: { getPromisableQuantities: jest.Mock };
  let orderRecords: { applyOrderEdit: jest.Mock };
  let recorder: { record: jest.Mock };
  let products: { getEffectiveTaxRate: jest.Mock; getVariantsByIds: jest.Mock };
  let service: OrderGiftService;

  const written = (key: string) =>
    ({
      orderEdits: readOrderEdits({
        v: 1,
        rev: 1,
        addedLines: {
          [key]: {
            changeId: 'rule-1',
            editedAt: PLACED.toISOString(),
            editedBy: null,
            productId: 'p-gift',
            variantId: 'v-gift',
            quantity: 1,
            gift: { source: 'ol-rule', ruleRef: 'rule-1', documentForm: 'technical-cent' },
          },
        },
      }),
    }) as never;

  beforeEach(() => {
    giftRules = {
      listOrderedRules: jest.fn().mockResolvedValue([makeRule()]),
      getGrantsForOrder: jest.fn().mockResolvedValue([]),
      getLedgerSnapshot: jest.fn().mockResolvedValue({
        states: new Map(),
        unitsGiven: new Map(),
        customerUnits: new Map(),
      }),
      withRulesLocked: jest.fn().mockImplementation((_ids: string[], work: () => Promise<unknown>) => work()),
      recordGrant: jest.fn().mockResolvedValue(true),
      applyStateChange: jest.fn().mockResolvedValue(undefined),
    };
    availability = {
      getPromisableQuantities: jest.fn().mockResolvedValue([
        { productVariantId: 'v-gift', quantity: 10, provenance: 'computed' },
      ]),
    };
    orderRecords = { applyOrderEdit: jest.fn().mockResolvedValue(written(olGiftLineKey('rule-1', '1'))) };
    recorder = { record: jest.fn().mockResolvedValue(undefined) };
    products = {
      getVariantsByIds: jest.fn().mockResolvedValue([
        { id: 'v-gift', netUnitCost: '3.5000', costCurrency: 'PLN', costUpdatedAt: new Date('2025-12-01T00:00:00Z') },
      ]),
      getEffectiveTaxRate: jest
        .fn()
        .mockResolvedValue({ code: '23', countryIso2: 'PL', readAt: new Date('2026-01-01T00:00:00Z') }),
    };
    service = new OrderGiftService(
      giftRules as never,
      availability as never,
      orderRecords as never,
      recorder as never,
      products as never
    );
  });

  const apply = (order: Order, edits = null as never, extra: object = {}) =>
    service.applyGiftRules({
      order,
      channelOrder: order,
      edits,
      customerId: 'cust-1',
      sourceConnectionId: 'c1',
      occurredAt: PLACED,
      isFirstIngestion: true,
      ...extra,
    });

  it('should write the gift into the overlay, stamp the form, and return the order with the gift line', async () => {
    const result = await apply(makeOrder());

    expect(giftRules.recordGrant).toHaveBeenCalledWith({
      ruleId: 'rule-1',
      internalOrderId: 'ol_order_1',
      customerId: 'cust-1',
      quantity: 1,
    });
    const call = (orderRecords.applyOrderEdit.mock.calls as [ApplyOrderEditInput][])[0][0];
    expect(call.expectedRev).toBeNull();
    expect(call.addedLines?.[olGiftLineKey('rule-1', '1')]).toMatchObject({
      productId: 'p-gift',
      quantity: 1,
      gift: { source: 'ol-rule', ruleRef: 'rule-1', documentForm: 'technical-cent' },
    });
    expect(result.order.items).toHaveLength(2);
    expect(result.order.items[1]).toMatchObject({ price: 0, gift: { source: 'ol-rule' } });
  });

  it('should stamp the catalogue tax rate on the overlay entry, and read back onto the order item (#3939)', async () => {
    await apply(makeOrder());

    const call = (orderRecords.applyOrderEdit.mock.calls as [ApplyOrderEditInput][])[0][0];
    const entry = call.addedLines?.[olGiftLineKey('rule-1', '1')];
    expect(entry).toMatchObject({ taxRate: '23', taxRateCountry: 'PL', taxSource: 'shop' });

    // The overlay is what documents read: the rate survives the persisted round trip.
    const edits = readOrderEdits(JSON.parse(JSON.stringify({ v: 1, rev: 1, addedLines: call.addedLines })));
    const item = applyOrderEditsToOrder(makeOrder(), edits).items.find((i) => i.gift !== undefined);
    expect(item).toMatchObject({ taxRate: '23', taxRateCountry: 'PL', taxSource: 'shop', price: 0 });
  });

  it('should freeze the gift cost on the entry when it was recorded before the order was placed (ADR-080)', async () => {
    await apply(makeOrder());

    const call = (orderRecords.applyOrderEdit.mock.calls as [ApplyOrderEditInput][])[0][0];
    expect(call.addedLines?.[olGiftLineKey('rule-1', '1')]).toMatchObject({
      unitCostNet: '3.5000',
      unitCostCurrency: 'PLN',
    });
  });

  it('should freeze no cost when it was entered after the order was placed, and never 0', async () => {
    products.getVariantsByIds.mockResolvedValue([
      { id: 'v-gift', netUnitCost: '3.5000', costCurrency: 'PLN', costUpdatedAt: new Date(PLACED.getTime() + 60_000) },
    ]);

    await apply(makeOrder());

    const call = (orderRecords.applyOrderEdit.mock.calls as [ApplyOrderEditInput][])[0][0];
    expect(call.addedLines?.[olGiftLineKey('rule-1', '1')]).not.toHaveProperty('unitCostNet');
  });

  it('should leave the entry without a rate when the catalogue has no answer', async () => {
    products.getEffectiveTaxRate.mockResolvedValue({ code: null, countryIso2: null, readAt: null });

    await apply(makeOrder());

    const call = (orderRecords.applyOrderEdit.mock.calls as [ApplyOrderEditInput][])[0][0];
    expect(call.addedLines?.[olGiftLineKey('rule-1', '1')]).not.toHaveProperty('taxRate');
  });

  it('should add nothing on a re-ingestion that already carries the gift', async () => {
    const key = olGiftLineKey('rule-1', '1');
    const edits = readOrderEdits({
      v: 1,
      rev: 1,
      addedLines: {
        [key]: {
          changeId: 'rule-1',
          editedAt: PLACED.toISOString(),
          editedBy: null,
          productId: 'p-gift',
          quantity: 1,
          gift: { source: 'ol-rule' },
        },
      },
    });
    const result = await apply(makeOrder(), edits as never);

    expect(giftRules.recordGrant).not.toHaveBeenCalled();
    expect(orderRecords.applyOrderEdit).not.toHaveBeenCalled();
    expect(recorder.record).not.toHaveBeenCalled();
    expect(result.outcomes[0]).toMatchObject({ applied: true, alreadyApplied: true });
  });

  it('should re-add a missing line from the ledger without counting the grant twice', async () => {
    giftRules.getGrantsForOrder.mockResolvedValue([
      { ruleId: 'rule-1', internalOrderId: 'ol_order_1', customerId: 'cust-1', quantity: 3, createdAt: PLACED },
    ]);
    await apply(makeOrder());

    expect(giftRules.recordGrant).not.toHaveBeenCalled();
    const call = (orderRecords.applyOrderEdit.mock.calls as [ApplyOrderEditInput][])[0][0];
    expect(call.addedLines?.[olGiftLineKey('rule-1', '1')].quantity).toBe(3);
  });

  it('should add nothing to an order placed before the rule was saved', async () => {
    giftRules.listOrderedRules.mockResolvedValue([makeRule({}, new Date('2026-11-03T00:00:00.000Z'))]);
    const result = await apply(makeOrder());
    expect(result.order.items).toHaveLength(1);
    expect(orderRecords.applyOrderEdit).not.toHaveBeenCalled();
  });

  it('should add nothing to a cancelled order', async () => {
    const result = await apply(makeOrder('cancelled'));
    expect(giftRules.listOrderedRules).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([]);
  });

  it('should record the pause and leave the order without a gift when the gift is out of stock', async () => {
    availability.getPromisableQuantities.mockResolvedValue([
      { productVariantId: 'v-gift', quantity: 0, provenance: 'computed' },
    ]);
    const result = await apply(makeOrder());

    expect(giftRules.applyStateChange).toHaveBeenCalledWith('rule-1', {
      kind: 'pause',
      reason: 'gift-out-of-stock',
    });
    expect(orderRecords.applyOrderEdit).not.toHaveBeenCalled();
    expect(result.order.items).toHaveLength(1);
    expect(recorder.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'nothing-to-do' })
    );
  });

  it('should not pause or add when the stock read is unknown', async () => {
    availability.getPromisableQuantities.mockResolvedValue([
      { productVariantId: 'v-gift', quantity: null, provenance: 'unknown' },
    ]);
    const result = await apply(makeOrder());
    expect(giftRules.applyStateChange).not.toHaveBeenCalled();
    expect(result.outcomes[0].reason).toBe('gift-stock-unknown');
  });

  it('should read the ledger and write the grant under a lock on the candidate rule', async () => {
    await apply(makeOrder());
    expect(giftRules.withRulesLocked).toHaveBeenCalledWith(['rule-1'], expect.any(Function));
    expect(giftRules.withRulesLocked.mock.invocationCallOrder[0]).toBeLessThan(
      giftRules.recordGrant.mock.invocationCallOrder[0]
    );
  });

  it('should keep the order flowing but record a FAILED run naming the rule and order when applying fails', async () => {
    orderRecords.applyOrderEdit.mockRejectedValue(new Error('db down'));
    const order = makeOrder();
    const result = await apply(order);

    expect(result.order).toBe(order);
    expect(recorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failed',
        rule: expect.objectContaining({ id: 'rule-1' }),
        facts: expect.objectContaining({ subjectId: 'ol_order_1' }),
        steps: [expect.objectContaining({ status: 'failed', detail: expect.stringContaining('ol_order_1') })],
      })
    );
  });

  it('should continue the order without a gift when the rules cannot be read', async () => {
    giftRules.listOrderedRules.mockRejectedValue(new Error('db down'));
    const order = makeOrder();
    const result = await apply(order);
    expect(result.order).toBe(order);
  });

  it('should preview without writing anything', async () => {
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
    const preview = await service.previewForOrder({ record: record as never });
    expect(preview.outcomes[0]).toMatchObject({ applied: true });
    expect(giftRules.recordGrant).not.toHaveBeenCalled();
    expect(orderRecords.applyOrderEdit).not.toHaveBeenCalled();
    expect(giftRules.applyStateChange).not.toHaveBeenCalled();
  });
});
