import { mapShoperTaxName, mapShoperTaxRow } from '../shoper-tax-rate.mapper';

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

  it.each([
    ['23.5%'],
    ['VAT'],
    ['stawka zwolniona'],
    ['100%'],
    [''],
    ['  '],
    [null],
    [undefined],
    // No live row has ever carried it; an unrecognised name is the safe default.
    ['oo'],
  ])('should not guess a rate for %p', (name) => {
    expect(mapShoperTaxName(name)).toBeNull();
  });
});

describe('mapShoperTaxRow', () => {
  it.each([
    // The live trial shop's /taxes table, name + value exactly as served.
    ['23%', '23', '23'],
    ['8%', '8', '8'],
    ['0%', '0', '0'],
    ['zw.', '0', 'zw'],
    ['np.', '0', 'np'],
    ['5%', '5', '5'],
  ])('should accept the consistent live row %p / value %p as %p', (name, value, code) => {
    expect(mapShoperTaxRow({ name, value })).toEqual({ ok: true, code });
  });

  it('should tolerate a value spelled with decimals', () => {
    expect(mapShoperTaxRow({ name: '23%', value: '23.00' })).toEqual({ ok: true, code: '23' });
  });

  it.each([
    ['a name that says 23% over a value of 8', '23%', '8'],
    ['a name that says 8% over a value of 23', '8%', '23'],
    ['a 0% name over a non-zero value', '0%', '23'],
    ['an exempt name over a non-zero value', 'zw.', '23'],
    ['a not-applicable name over a non-zero value', 'np.', '8'],
  ])('should refuse %s: two fields that contradict each other are a guess', (_label, name, value) => {
    const result = mapShoperTaxRow({ name, value });

    expect(result).toMatchObject({ ok: false, reason: 'value-mismatch' });
    expect(result.ok === false && result.detail).toContain(name);
  });

  it.each([[''], ['abc'], [null], [undefined]])(
    'should refuse a recognised name whose value is not a number (%p)',
    (value) => {
      expect(
        mapShoperTaxRow({ name: '23%', value: value as unknown as string }),
      ).toMatchObject({ ok: false, reason: 'value-mismatch' });
    },
  );

  it('should report an unrecognised name as such, not as a mismatch', () => {
    expect(mapShoperTaxRow({ name: 'stawka specjalna', value: '7' })).toMatchObject({
      ok: false,
      reason: 'unrecognised-name',
    });
  });
});
