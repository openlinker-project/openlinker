import { readLineGift } from './incoming-order.types';

describe('readLineGift custom-price', () => {
  it('should keep a custom-price form together with its amount', () => {
    expect(
      readLineGift({ source: 'operator', documentForm: 'custom-price', documentUnitPrice: '4.50' }),
    ).toEqual({ source: 'operator', documentForm: 'custom-price', documentUnitPrice: '4.50' });
  });

  it('should read a custom-price without a usable amount as "as in settings"', () => {
    for (const documentUnitPrice of [undefined, '0', '1.234', 'x', 5]) {
      expect(readLineGift({ source: 'operator', documentForm: 'custom-price', documentUnitPrice })).toEqual({
        source: 'operator',
      });
    }
  });

  it('should not carry an amount for any other form', () => {
    expect(readLineGift({ source: 'operator', documentForm: 'omit', documentUnitPrice: '4' })).toEqual({
      source: 'operator',
      documentForm: 'omit',
    });
  });
});
