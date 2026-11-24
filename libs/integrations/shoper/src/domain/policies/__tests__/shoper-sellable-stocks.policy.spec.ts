import type { ShoperStock } from '../../types/shoper-api.types';
import {
  isExtendedShoperStock,
  partitionSellableShoperStocks,
  selectSellableShoperStocks,
} from '../shoper-sellable-stocks.policy';

type Row = Pick<ShoperStock, 'stock_id' | 'extended'>;

function row(stock_id: string, extended?: string): Row {
  return extended === undefined ? { stock_id } : { stock_id, extended };
}

describe('selectSellableShoperStocks', () => {
  /** Product 161 as read live: base 264 plus four colour stocks. */
  const PRODUCT_161 = [row('264', '0'), row('265', '1'), row('266', '1')]
    .concat([row('267', '1'), row('268', '1')]);

  it('should leave the base stock out of a product that has variant stocks', () => {
    expect(selectSellableShoperStocks(PRODUCT_161).map((s) => s.stock_id)).toEqual([
      '265',
      '266',
      '267',
      '268',
    ]);
  });

  it('should keep the base stock of a product with one variant out too', () => {
    const stocks = [row('269', '0'), row('270', '1')];
    expect(selectSellableShoperStocks(stocks).map((s) => s.stock_id)).toEqual(['270']);
  });

  it('should keep the base stock as the single variant of a simple product', () => {
    const stocks = [row('271', '0')];
    expect(selectSellableShoperStocks(stocks).map((s) => s.stock_id)).toEqual(['271']);
  });

  it('should keep every row when none reports extended, rather than dropping one', () => {
    const stocks = [row('1'), row('2')];
    expect(selectSellableShoperStocks(stocks).map((s) => s.stock_id)).toEqual(['1', '2']);
  });

  it('should return an empty list for no rows', () => {
    expect(selectSellableShoperStocks([])).toEqual([]);
  });

  it.each([
    ['1', true],
    [1, true],
    ['0', false],
    [0, false],
    [null, false],
    [undefined, false],
  ])('should read extended %p as %p', (extended, expected) => {
    expect(isExtendedShoperStock({ extended })).toBe(expected);
  });
});

describe('partitionSellableShoperStocks', () => {
  type Stock = Pick<ShoperStock, 'stock_id' | 'default' | 'options' | 'extended'>;

  function stock(overrides: Partial<Stock> & Pick<Stock, 'stock_id'>): Stock {
    return { default: '1', options: [], ...overrides };
  }

  /** Live product 127: base stock 215 and two variant stocks. */
  const LIVE_127: Stock[] = [
    stock({ stock_id: '215', extended: '0' }),
    stock({ stock_id: '217', default: '0', options: { '10': '68' }, extended: '1' }),
    stock({ stock_id: '218', default: '0', options: { '10': '76' }, extended: '1' }),
  ];

  it('should keep every row of a simple product and report no base row', () => {
    const stocks = [stock({ stock_id: '181' })];
    expect(partitionSellableShoperStocks(stocks)).toEqual({ variants: stocks, base: null });
  });

  it('should drop the live base row of a product with variants and keep it as the base', () => {
    const { variants, base } = partitionSellableShoperStocks(LIVE_127);
    expect(variants.map((s) => s.stock_id)).toEqual(['217', '218']);
    expect(base?.stock_id).toBe('215');
  });

  it('should fall back to options for rows that do not report extended', () => {
    const rows = LIVE_127.map(({ extended: _extended, ...rest }) => rest);
    const { variants, base } = partitionSellableShoperStocks(rows);
    expect(variants.map((s) => s.stock_id)).toEqual(['217', '218']);
    expect(base?.stock_id).toBe('215');
  });

  it('should keep a row with malformed options as a variant, never as the base', () => {
    const malformed = stock({ stock_id: '300', default: '0', options: ['x'] as unknown as [] });
    const { variants, base } = partitionSellableShoperStocks([stock({ stock_id: '299' }), malformed]);
    expect(variants.map((s) => s.stock_id)).toEqual(['300']);
    expect(base?.stock_id).toBe('299');
  });

  it('should pick the default base row when a product reports more than one', () => {
    const { base } = partitionSellableShoperStocks([
      stock({ stock_id: '1', default: '0', extended: '0' }),
      stock({ stock_id: '2', default: '1', extended: '0' }),
      stock({ stock_id: '3', default: '0', extended: '1' }),
    ]);
    expect(base?.stock_id).toBe('2');
  });
});
