import {
  applyOrderEditsToOrder,
  applyOrderEditsToSnapshot,
  olGiftLineKey,
  readOrderEdits,
} from './order-edits.types';
import { readLineGift } from './incoming-order.types';
import type { Order } from './order.types';

const KEY = olGiftLineKey('rule-1', '1');
const STAMP = { changeId: 'rule-1', editedAt: '2026-11-02T10:00:00.000Z', editedBy: null };
const RAW = {
  v: 1,
  rev: 1,
  addedLines: {
    [KEY]: {
      ...STAMP,
      productId: 'p-gift',
      variantId: 'v-gift',
      quantity: 2,
      gift: { source: 'ol-rule', ruleRef: 'rule-1', documentForm: 'priced-in' },
    },
  },
};

const ORDER: Order = {
  id: 'ol_order_1',
  status: 'pending',
  items: [{ id: 'l1', productId: 'p-book', quantity: 1, price: 100 }],
  totals: { subtotal: 100, tax: 0, shipping: 0, total: 100, currency: 'PLN' },
} as unknown as Order;

describe('overlay addedLines', () => {
  it('should read a well-formed added line, including its document form', () => {
    const edits = readOrderEdits(RAW);
    expect(edits?.addedLines?.[KEY]).toMatchObject({
      productId: 'p-gift',
      quantity: 2,
      gift: { source: 'ol-rule', documentForm: 'priced-in' },
    });
  });

  it('should drop an added line with a foreign key prefix or a non-positive quantity', () => {
    const edits = readOrderEdits({
      ...RAW,
      addedLines: {
        'x:1': RAW.addedLines[KEY],
        [KEY]: { ...RAW.addedLines[KEY], quantity: 0 },
      },
    });
    expect(edits).toBeNull();
  });

  it('should read an unknown document form as absent rather than guess', () => {
    expect(readLineGift({ source: 'operator', documentForm: 'free' })).toEqual({ source: 'operator' });
  });

  it('should append the gift to the live order at price 0 without moving the total', () => {
    const merged = applyOrderEditsToOrder(ORDER, readOrderEdits(RAW));
    expect(merged.items).toHaveLength(2);
    expect(merged.items[1]).toMatchObject({ id: KEY, price: 0, quantity: 2, gift: { source: 'ol-rule' } });
    expect(merged.totals.total).toBe(100);
  });

  it('should append the gift to the effective snapshot and leave the channel original alone', () => {
    const snapshot = { items: [{ id: 'l1', productId: 'p-book', quantity: 1, price: 100 }], totals: ORDER.totals };
    const merged = applyOrderEditsToSnapshot(snapshot, readOrderEdits(RAW));
    expect((merged.items as unknown[]).length).toBe(2);
    expect(snapshot.items).toHaveLength(1);
  });
});

describe('overlay gift line gross price', () => {
  it('should carry unitPriceGross 0 beside price 0 so a net-priced order stays documentable', () => {
    const edits = readOrderEdits(RAW);
    const order = applyOrderEditsToOrder(ORDER, edits);
    const gift = order.items.find((item) => item.gift !== undefined);
    expect(gift).toMatchObject({ price: 0, unitPriceGross: 0 });
  });
});
