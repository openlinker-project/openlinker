/**
 * Mirakl Offer File Policy: unit tests
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import {
  buildMiraklOfferFile,
  formatMiraklPrice,
  formatMiraklQuantity,
} from '../mirakl-offer-file.policy';

describe('buildMiraklOfferFile', () => {
  it('should build an STO01 file that carries only the quantity', () => {
    expect(
      buildMiraklOfferFile('stock', [
        { offerSku: 'SKU-1', value: '7' },
        { offerSku: 'SKU-2', value: '0' },
      ])
    ).toBe('offer-sku;quantity\nSKU-1;7\nSKU-2;0\n');
  });

  it('should build a PRI01 file that carries only the price', () => {
    expect(buildMiraklOfferFile('price', [{ offerSku: 'SKU-1', value: '44.99' }])).toBe(
      'offer-sku;price\nSKU-1;44.99\n'
    );
  });

  it('should quote a SKU carrying a separator or a quote', () => {
    expect(buildMiraklOfferFile('stock', [{ offerSku: 'A;"B"', value: '1' }])).toBe(
      'offer-sku;quantity\n"A;""B""";1\n'
    );
  });
});

describe('formatMiraklQuantity / formatMiraklPrice', () => {
  it('should send a whole, non-negative quantity', () => {
    expect(formatMiraklQuantity(4.7)).toBe('4');
    expect(formatMiraklQuantity(-3)).toBe('0');
  });

  it('should send a price with two decimals and refuse a non-number', () => {
    expect(formatMiraklPrice('44.9')).toBe('44.90');
    expect(formatMiraklPrice('abc')).toBeNull();
    expect(formatMiraklPrice('-1')).toBeNull();
  });
});
