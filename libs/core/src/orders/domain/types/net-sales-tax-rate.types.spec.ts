import { netSalesRateFractionSql, resolveNetSalesTaxRate } from './net-sales-tax-rate.types';

describe('resolveNetSalesTaxRate', () => {
  it.each([
    ['23', 0.23],
    ['8', 0.08],
    ['5', 0.05],
    ['0', 0],
  ])('resolves numeric code %s to a known %s fraction', (taxRate, expected) => {
    expect(resolveNetSalesTaxRate(taxRate)).toEqual({ kind: 'known', rateFraction: expected });
  });

  it.each(['zw', 'np', 'oo'])('resolves exempt code %s to a known 0 fraction', (taxRate) => {
    expect(resolveNetSalesTaxRate(taxRate)).toEqual({ kind: 'known', rateFraction: 0 });
  });

  it.each([null, undefined, '', '   '])('resolves %s to unknown', (taxRate) => {
    expect(resolveNetSalesTaxRate(taxRate)).toEqual({ kind: 'unknown' });
  });

  it('resolves fractional notation to unknown rather than guessing', () => {
    expect(resolveNetSalesTaxRate('0.23')).toEqual({ kind: 'unknown' });
  });

  it('resolves an out-of-range percent to unknown', () => {
    expect(resolveNetSalesTaxRate('150')).toEqual({ kind: 'unknown' });
    expect(resolveNetSalesTaxRate('-5')).toEqual({ kind: 'unknown' });
  });

  it('resolves a garbage string to unknown', () => {
    expect(resolveNetSalesTaxRate('not-a-rate')).toEqual({ kind: 'unknown' });
  });
});

describe('netSalesRateFractionSql', () => {
  it('produces a CASE expression referencing the given column', () => {
    const sql = netSalesRateFractionSql('li."taxRate"');
    expect(sql).toContain('li."taxRate" IN (\'zw\',\'np\',\'oo\')');
    expect(sql).toContain('li."taxRate"::numeric / 100');
  });
});
