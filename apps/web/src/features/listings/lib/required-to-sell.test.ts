import { describe, expect, it } from 'vitest';
import { checkShopLineSellability } from './required-to-sell';

describe('checkShopLineSellability', () => {
  it('reports no issues when stock is positive', () => {
    expect(checkShopLineSellability(5)).toEqual([]);
  });

  it('warns OUT_OF_STOCK when stock is zero', () => {
    expect(checkShopLineSellability(0)).toEqual([
      expect.objectContaining({ code: 'OUT_OF_STOCK' }),
    ]);
  });

  it('warns OUT_OF_STOCK when stock is negative', () => {
    expect(checkShopLineSellability(-1).map((i) => i.code)).toEqual(['OUT_OF_STOCK']);
  });
});
