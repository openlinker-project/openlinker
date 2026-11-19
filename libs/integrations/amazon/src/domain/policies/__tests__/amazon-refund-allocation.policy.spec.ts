/**
 * Amazon refund allocation tests (#4184)
 *
 * @module libs/integrations/amazon/src/domain/policies/__tests__
 */
import { allocateAmazonRefund } from '../amazon-refund-allocation.policy';

const ITEMS = [
  { orderItemId: 'I1', sku: 'MUG', paidMinor: 2000, quantity: 2 },
  { orderItemId: 'I2', sku: 'CUP', paidMinor: 500, quantity: 1 },
];

describe('allocateAmazonRefund', () => {
  it('should put the amount on the returned items up to their returned quantity', () => {
    expect(allocateAmazonRefund(1000, ITEMS, [{ sku: 'MUG', quantity: 1 }])).toEqual({
      ok: true,
      parts: [{ orderItemId: 'I1', amountMinor: 1000 }],
    });
  });

  it('should accept a partial amount', () => {
    expect(allocateAmazonRefund(250, ITEMS, [{ sku: 'CUP', quantity: 1 }])).toEqual({
      ok: true,
      parts: [{ orderItemId: 'I2', amountMinor: 250 }],
    });
  });

  it('should spread over every item when the return is not known', () => {
    expect(allocateAmazonRefund(2300, ITEMS, null)).toEqual({
      ok: true,
      parts: [
        { orderItemId: 'I1', amountMinor: 2000 },
        { orderItemId: 'I2', amountMinor: 300 },
      ],
    });
  });

  it('should refuse more than the returned items cost, and items not on the order', () => {
    expect(allocateAmazonRefund(1001, ITEMS, [{ sku: 'MUG', quantity: 1 }]).ok).toBe(false);
    expect(allocateAmazonRefund(100, ITEMS, [{ sku: 'PLATE', quantity: 1 }]).ok).toBe(false);
    expect(allocateAmazonRefund(0, ITEMS, null).ok).toBe(false);
  });

  it('should bound a part of an item by its share of what was paid, rounded down', () => {
    const odd = [{ orderItemId: 'I1', sku: 'MUG', paidMinor: 1001, quantity: 2 }];

    expect(allocateAmazonRefund(500, odd, [{ sku: 'MUG', quantity: 1 }]).ok).toBe(true);
    expect(allocateAmazonRefund(501, odd, [{ sku: 'MUG', quantity: 1 }]).ok).toBe(false);
    expect(allocateAmazonRefund(1001, odd, [{ sku: 'MUG', quantity: 2 }]).ok).toBe(true);
  });
});
