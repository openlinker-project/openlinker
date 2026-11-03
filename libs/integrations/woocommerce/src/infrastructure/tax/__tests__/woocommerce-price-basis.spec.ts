/**
 * WooCommerce Price Basis - unit tests (ADR-077)
 *
 * The pure half of the WooCommerce tax-basis conversion: which stored prices
 * are already gross, which tax class a line resolves to, and the two
 * conversions the product master and the publisher share.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/tax/__tests__
 */
import {
  WOOCOMMERCE_DEFAULT_PRICE_DECIMALS,
  effectiveTaxClass,
  isStoredPriceGross,
  toGrossPrice,
  toNetPrice,
  type WooCommerceStorePriceBasis,
} from '../woocommerce-price-basis';

function basis(overrides: Partial<WooCommerceStorePriceBasis> = {}): WooCommerceStorePriceBasis {
  return {
    taxesEnabled: true,
    pricesIncludeTax: false,
    priceDecimals: WOOCOMMERCE_DEFAULT_PRICE_DECIMALS,
    storeCountry: 'PL',
    ...overrides,
  };
}

describe('woocommerce-price-basis', () => {
  describe('isStoredPriceGross', () => {
    it.each<[string, Partial<WooCommerceStorePriceBasis>, string | undefined, boolean]>([
      ['taxes are off', { taxesEnabled: false }, 'taxable', true],
      ['taxes are off and the status is unknown', { taxesEnabled: false }, undefined, true],
      ['prices are entered with tax', { pricesIncludeTax: true }, 'taxable', true],
      ['prices are entered with tax and the status is unknown', { pricesIncludeTax: true }, undefined, true],
      ['the product is not taxed', {}, 'none', true],
      ['the product taxes only its shipping', {}, 'shipping', true],
      ['the store enters prices without tax for a taxable product', {}, 'taxable', false],
      ['the store enters prices without tax and the status is unknown', {}, undefined, false],
    ])('should answer correctly when %s', (_label, overrides, taxStatus, expected) => {
      expect(isStoredPriceGross(basis(overrides), taxStatus)).toBe(expected);
    });
  });

  describe('effectiveTaxClass', () => {
    it.each<[string, string | undefined, string | undefined, string]>([
      ['the class is empty (standard on a line)', '', undefined, ''],
      ['the class is the standard slug', 'standard', undefined, ''],
      ['the class is a named class', 'reduced-rate', undefined, 'reduced-rate'],
      ['the class is a named class and a parent class is given', 'reduced-rate', 'zero-rate', 'reduced-rate'],
      ['the class is parent and the parent has a named class', 'parent', 'reduced-rate', 'reduced-rate'],
      ['the class is parent and the parent is on the standard slug', 'parent', 'standard', ''],
      ['the class is parent and the parent is on the empty class', 'parent', '', ''],
      ['the class is parent and no parent class is known', 'parent', undefined, ''],
      ['the class is parent and the parent itself says parent', 'parent', 'parent', ''],
      ['the class is missing and the parent has a named class', undefined, 'zero-rate', 'zero-rate'],
      ['the class is missing and no parent class is known', undefined, undefined, ''],
    ])('should resolve the line class when %s', (_label, taxClass, parentTaxClass, expected) => {
      expect(effectiveTaxClass(taxClass, parentTaxClass)).toBe(expected);
    });
  });

  describe('toGrossPrice', () => {
    it('should gross up a round net price at 23% to 2 decimals', () => {
      expect(toGrossPrice(100, 23, 2)).toBe(123);
    });

    it('should round half-up to 2 decimals when the exact gross has more', () => {
      // 9.99 x 1.23 = 12.2877
      expect(toGrossPrice(9.99, 23, 2)).toBe(12.29);
    });

    it('should round an exact half up at 2 decimals', () => {
      // 0.5 x 1.01 = 0.505
      expect(toGrossPrice(0.5, 1, 2)).toBe(0.51);
    });

    it('should round to whole units when the store shows 0 decimals', () => {
      // 9.99 x 1.23 = 12.2877
      expect(toGrossPrice(9.99, 23, 0)).toBe(12);
      expect(toGrossPrice(100, 23, 0)).toBe(123);
    });

    it('should round an exact half up at 0 decimals', () => {
      // 50 x 1.05 = 52.5
      expect(toGrossPrice(50, 5, 0)).toBe(53);
    });

    it('should leave the price as it is when the rate is 0', () => {
      expect(toGrossPrice(12.34, 0, 2)).toBe(12.34);
    });

    it('should keep a zero price at zero', () => {
      expect(toGrossPrice(0, 23, 2)).toBe(0);
    });
  });

  describe('toNetPrice', () => {
    it('should return the net figure as a plain decimal string when it is round', () => {
      expect(toNetPrice(123, 23)).toBe('100');
    });

    it('should keep 6 decimals when the net figure is not round', () => {
      // 12.29 / 1.23 = 9.9918699...
      expect(toNetPrice(12.29, 23)).toBe('9.99187');
      // 19.99 / 1.23 = 16.2520325...
      expect(toNetPrice(19.99, 23)).toBe('16.252033');
      // 19.99 / 1.08 = 18.5092592...
      expect(toNetPrice(19.99, 8)).toBe('18.509259');
    });

    it('should never write more than 6 decimals', () => {
      for (const gross of [0.01, 9.99, 19.99, 49.9, 1234.56]) {
        for (const rate of [5, 8, 23]) {
          expect(toNetPrice(gross, rate)).toMatch(/^\d+(\.\d{1,6})?$/);
        }
      }
    });

    it('should return the gross unchanged when the rate is 0', () => {
      expect(toNetPrice(49.9, 0)).toBe('49.9');
    });

    it('should land back on the original gross when the net figure is grossed up again', () => {
      for (const gross of [0.01, 1, 9.99, 12.29, 19.99, 49.9, 123, 999.99, 1234.56]) {
        for (const rate of [5, 8, 23]) {
          const net = Number(toNetPrice(gross, rate));

          expect(toGrossPrice(net, rate, 2)).toBe(gross);
        }
      }
    });
  });
});
