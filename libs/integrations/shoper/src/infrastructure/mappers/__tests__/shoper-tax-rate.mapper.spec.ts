import { mapShoperTaxName } from '../shoper-tax-rate.mapper';

describe('mapShoperTaxName', () => {
  it.each([
    // Every row of the live trial shop's /taxes table.
    ['23%', '23'],
    ['8%', '8'],
    ['0%', '0'],
    ['zw.', 'zw'],
    ['np.', 'np'],
    ['5%', '5'],
    // Tolerated spellings.
    ['oo', 'oo'],
    ['ZW.', 'zw'],
    ['  23 %  ', '23'],
    ['23', '23'],
    ['23,0%', '23'],
    ['23.00', '23'],
    ['np', 'np'],
  ])('should map %p to %p', (name, code) => {
    expect(mapShoperTaxName(name)).toBe(code);
  });

  it('should keep the three zero-valued rows apart', () => {
    expect(new Set(['0%', 'zw.', 'np.'].map(mapShoperTaxName)).size).toBe(3);
  });

  it.each([['23.5%'], ['VAT'], ['stawka zwolniona'], ['100%'], [''], ['  '], [null], [undefined]])(
    'should not guess a rate for %p',
    (name) => {
      expect(mapShoperTaxName(name)).toBeNull();
    },
  );
});
