/**
 * PrestaShop gift cart-rule split tests (#3937)
 *
 * The fixtures are the shape a live PrestaShop 9.0.2 order produced: a gift
 * product is added to the cart as one extra unit of the product, merged into
 * its line at full price, while the discount carries the gift's price.
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers/__tests__
 */
import { PrestashopOrderMapper } from '../prestashop-order.mapper';
import { sourceRowIdOfLineId } from '../prestashop-gift-split';
import type { PrestashopOrder, PrestashopOrderRow } from '../prestashop.mapper.interface';

const RULE = { idCartRule: '7', giftProductId: '20', giftProductAttributeId: '0', valueTaxIncl: 50 };

function order(overrides: Partial<PrestashopOrder> = {}): PrestashopOrder {
  return {
    id: 6,
    reference: 'ABCDEFGHI',
    current_state: 2,
    total_paid_tax_incl: '62.500000',
    total_paid_tax_excl: '62.500000',
    total_shipping: '12.500000',
    total_discounts_tax_incl: '50.000000',
    date_add: '2026-11-05 00:34:09',
    date_upd: '2026-11-05 00:34:09',
    ...overrides,
  };
}

function row(overrides: Partial<PrestashopOrderRow> = {}): PrestashopOrderRow {
  return {
    id: 8,
    product_id: 20,
    product_attribute_id: 0,
    product_quantity: 2,
    product_price: '50.000000',
    unit_price_tax_incl: '50.000000',
    product_reference: 'GIFT-SKU-1',
    ...overrides,
  };
}

describe('PrestashopOrderMapper gift cart-rule split', () => {
  const mapper = new PrestashopOrderMapper();

  it('should split one unit of the merged line into a 0.00 gift line and lower the discount by its price', () => {
    const mapped = mapper.mapOrder(order(), [row()], [RULE]);

    expect(mapped.items).toHaveLength(2);
    expect(mapped.items[0]).toMatchObject({ id: '8', quantity: 1, price: 50, unitPriceGross: 50 });
    expect(mapped.items[0].gift).toBeUndefined();
    expect(mapped.items[1]).toMatchObject({
      id: '8~gift:7',
      quantity: 1,
      price: 0,
      unitPriceGross: 0,
      sku: 'GIFT-SKU-1',
      gift: { source: 'cart-rule', ruleRef: '7' },
    });
    expect(mapped.totals.discountTotal).toBe(0);
    expect(mapped.totals.total).toBe(62.5);
  });

  it('should keep the order total equal to what was paid after the split', () => {
    const mapped = mapper.mapOrder(order(), [row()], [RULE]);

    const lines = mapped.items.reduce((sum, item) => sum + item.quantity * (item.unitPriceGross ?? 0), 0);
    // Lines minus the discount plus shipping is what the buyer paid, split or not.
    expect(lines - (mapped.totals.discountTotal ?? 0) + 12.5).toBe(mapped.totals.total);
  });

  it('should mark the whole line in place when the gift is its only unit', () => {
    const mapped = mapper.mapOrder(order(), [row({ product_quantity: 1 })], [RULE]);

    expect(mapped.items).toHaveLength(1);
    expect(mapped.items[0]).toMatchObject({
      id: '8~gift:7',
      quantity: 1,
      price: 0,
      gift: { source: 'cart-rule', ruleRef: '7' },
    });
    expect(mapped.totals.discountTotal).toBe(0);
  });

  it('should only lower the discount by the gift, keeping the rest of a mixed discount', () => {
    const mapped = mapper.mapOrder(order({ total_discounts_tax_incl: '65.000000' }), [row()], [RULE]);

    expect(mapped.totals.discountTotal).toBe(15);
  });

  it('should produce identical ids on every poll so the amendment diff sees no change', () => {
    const first = mapper.mapOrder(order(), [row()], [RULE]);
    const second = mapper.mapOrder(order(), [row()], [RULE]);

    expect(second.items.map((i) => [i.id, i.quantity])).toEqual(first.items.map((i) => [i.id, i.quantity]));
  });

  it('should leave the order untouched when no gift cart rule applies', () => {
    const mapped = mapper.mapOrder(order({ total_discounts_tax_incl: '5.000000' }), [row()], []);

    expect(mapped.items).toHaveLength(1);
    expect(mapped.items[0]).toMatchObject({ id: '8', quantity: 2 });
    expect(mapped.totals.discountTotal).toBe(5);
  });

  it('should skip a rule whose gift product is not in the order', () => {
    const mapped = mapper.mapOrder(order(), [row({ product_id: 99 })], [RULE]);

    expect(mapped.items).toHaveLength(1);
    expect(mapped.items[0].gift).toBeUndefined();
    expect(mapped.totals.discountTotal).toBe(50);
  });

  it('should match the gift combination, not just the product', () => {
    const rule = { ...RULE, giftProductAttributeId: '31' };

    const other = mapper.mapOrder(order(), [row({ product_attribute_id: 30 })], [rule]);
    const same = mapper.mapOrder(order(), [row({ product_attribute_id: 31 })], [rule]);

    expect(other.items).toHaveLength(1);
    expect(same.items).toHaveLength(2);
  });

  it('should leave a gift merged when its line carries no readable gross unit price', () => {
    const mapped = mapper.mapOrder(order(), [row({ unit_price_tax_incl: undefined })], [RULE]);

    expect(mapped.items).toHaveLength(1);
    expect(mapped.totals.discountTotal).toBe(50);
  });

  it('should resolve a split line id back to the order row it came from', () => {
    expect(sourceRowIdOfLineId('8~gift:7')).toBe('8');
    expect(sourceRowIdOfLineId('8')).toBe('8');
  });

  it('should leave the gift merged when the rule credited less than the unit (free shipping, gift was paid)', () => {
    const rule = { ...RULE, valueTaxIncl: 12.5, freeShipping: true, shippingGross: 12.5 };
    const mapped = mapper.mapOrder(order({ total_discounts_tax_incl: '12.500000' }), [row()], [rule]);

    expect(mapped.items).toHaveLength(1);
    expect(mapped.items[0]).toMatchObject({ id: '8', quantity: 2 });
    expect(mapped.totals.discountTotal).toBe(12.5);
    expect(mapped.totals.total).toBe(62.5);
  });

  it('should split when a free-shipping rule credited the gift on top of the shipping', () => {
    const rule = { ...RULE, valueTaxIncl: 62.5, freeShipping: true, shippingGross: 12.5 };
    const mapped = mapper.mapOrder(order({ total_discounts_tax_incl: '62.500000' }), [row()], [rule]);

    expect(mapped.items).toHaveLength(2);
    expect(mapped.totals.discountTotal).toBe(12.5);
  });

  it('should leave the gift merged when the rule carries no booked value', () => {
    const rule = { ...RULE, valueTaxIncl: undefined };
    const mapped = mapper.mapOrder(order(), [row()], [rule]);

    expect(mapped.items).toHaveLength(1);
    expect(mapped.totals.discountTotal).toBe(50);
  });

  it('should round the discount in the currency minor unit', () => {
    const rule = { ...RULE, valueTaxIncl: 500 };
    const mapped = mapper.mapOrder(
      order({ total_discounts_tax_incl: '500', total_paid_tax_incl: '625' }),
      [row({ unit_price_tax_incl: '500', product_price: '500' })],
      [rule],
      0
    );

    expect(mapped.items).toHaveLength(2);
    expect(mapped.totals.discountTotal).toBe(0);
  });
});
