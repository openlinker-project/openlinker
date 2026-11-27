/**
 * Delivery Country Example Projection Specs (#3907)
 *
 * @module libs/core/src/orders/domain
 */
import { toDeliveryCountryExample } from './delivery-country-example';

describe('toDeliveryCountryExample', () => {
  it('should price each line as gross unit times quantity when unitPriceGross is reported', () => {
    const example = toDeliveryCountryExample(
      [{ name: 'Shirt', quantity: 2, unitPriceGross: 24.99, price: 20.32, taxRate: '23' }],
      { shipping: 10, shippingGross: 12.3 },
    );
    expect(example).toEqual({
      lines: [{ name: 'Shirt', gross: 49.98, rate: '23' }],
      delivery: 12.3,
    });
  });

  it('should fall back to price and shipping when gross figures are absent', () => {
    const example = toDeliveryCountryExample(
      [{ sku: 'SKU-1', quantity: 1, price: 10 }],
      { shipping: 5 },
    );
    expect(example).toEqual({ lines: [{ name: 'SKU-1', gross: 10, rate: null }], delivery: 5 });
  });

  it('should return null when there are no usable lines', () => {
    expect(toDeliveryCountryExample([], {})).toBeNull();
    expect(toDeliveryCountryExample(null, {})).toBeNull();
    expect(toDeliveryCountryExample([{ name: 'x' }], {})).toBeNull();
  });

  it('should never copy buyer fields into the example when the snapshot carries them', () => {
    const example = toDeliveryCountryExample(
      [{ name: 'Shirt', quantity: 1, price: 1, buyerEmail: 'a@b.c' }],
      { shipping: 0, buyerName: 'X' },
    );
    expect(JSON.stringify(example)).not.toContain('a@b.c');
    expect(JSON.stringify(example)).not.toContain('"X"');
  });
});
