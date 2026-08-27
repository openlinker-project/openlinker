/**
 * PrestaShop Pack Rule Tests (#2598)
 *
 * Pins the pack-availability derivation and its boundaries: the rule decides
 * what OpenLinker publishes for a pack, and every boundary here is a case where
 * a plausible-looking alternative either oversells or zeroes a live listing.
 *
 * @module libs/integrations/prestashop/src/domain/types/__tests__
 */
import {
  PACK_STOCK_TYPE_SHOP_DEFAULT,
  derivePackAvailability,
  packComponentStockKey,
  readPackDefinition,
  resolvePackStockMode,
  type PrestashopPackComponent,
} from '../prestashop-pack.types';

function component(
  productId: string,
  quantity: number,
  combinationId: string | null = null
): PrestashopPackComponent {
  return { productId, quantity, combinationId };
}

function availability(entries: Array<[string, string | null, number]>): Map<string, number> {
  return new Map(
    entries.map(([productId, combinationId, qty]) => [
      packComponentStockKey(productId, combinationId),
      qty,
    ])
  );
}

describe('readPackDefinition', () => {
  it('should return null when the product is not a pack', () => {
    expect(readPackDefinition({ id: '7', cache_is_pack: '0' })).toBeNull();
  });

  it('should return null for a missing or non-object product', () => {
    expect(readPackDefinition(undefined)).toBeNull();
    expect(readPackDefinition(null)).toBeNull();
    expect(readPackDefinition('42')).toBeNull();
  });

  it('should read components from the JSON association shape', () => {
    const definition = readPackDefinition({
      id: '7',
      cache_is_pack: '1',
      pack_stock_type: '1',
      associations: {
        product_bundle: [
          { id: '11', id_product_attribute: '0', quantity: '2' },
          { id: '12', id_product_attribute: '55', quantity: '1' },
        ],
      },
    });

    expect(definition).toEqual({
      rawStockType: 1,
      components: [
        { productId: '11', combinationId: null, quantity: 2 },
        { productId: '12', combinationId: '55', quantity: 1 },
      ],
    });
  });

  it('should read components from the XML association shape with a single entry', () => {
    const definition = readPackDefinition({
      id: '7',
      cache_is_pack: 1,
      pack_stock_type: 2,
      associations: { product_bundle: { product: { id: '11', quantity: '3' } } },
    });

    expect(definition?.rawStockType).toBe(2);
    expect(definition?.components).toEqual([
      { productId: '11', combinationId: null, quantity: 3 },
    ]);
  });

  it('should read a non-positive or absent bundle quantity as one unit per pack', () => {
    const definition = readPackDefinition({
      cache_is_pack: '1',
      associations: {
        product_bundle: [
          { id: '11', quantity: '0' },
          { id: '12' },
        ],
      },
    });

    expect(definition?.components.map((c) => c.quantity)).toEqual([1, 1]);
  });

  it('should default an absent pack_stock_type to the shop-default sentinel', () => {
    const definition = readPackDefinition({ cache_is_pack: '1' });
    expect(definition?.rawStockType).toBe(PACK_STOCK_TYPE_SHOP_DEFAULT);
    expect(definition?.components).toEqual([]);
  });

  it('should drop a bundle entry with no usable product id rather than guessing one', () => {
    const definition = readPackDefinition({
      cache_is_pack: '1',
      associations: { product_bundle: [{ quantity: '2' }, { id: '12', quantity: '1' }] },
    });

    expect(definition?.components).toEqual([{ productId: '12', combinationId: null, quantity: 1 }]);
  });
});

describe('resolvePackStockMode', () => {
  it('should map the three real PrestaShop values', () => {
    expect(resolvePackStockMode(0, 1)).toBe('pack-only');
    expect(resolvePackStockMode(1, 0)).toBe('components');
    expect(resolvePackStockMode(2, 0)).toBe('both');
  });

  it('should substitute the shop default for the 3 sentinel', () => {
    expect(resolvePackStockMode(PACK_STOCK_TYPE_SHOP_DEFAULT, 0)).toBe('pack-only');
    expect(resolvePackStockMode(PACK_STOCK_TYPE_SHOP_DEFAULT, 1)).toBe('components');
    expect(resolvePackStockMode(PACK_STOCK_TYPE_SHOP_DEFAULT, 2)).toBe('both');
  });

  it('should fall back to the lower of both readings when the shop default is unusable', () => {
    expect(resolvePackStockMode(PACK_STOCK_TYPE_SHOP_DEFAULT, null)).toBe('both');
    expect(resolvePackStockMode(PACK_STOCK_TYPE_SHOP_DEFAULT, PACK_STOCK_TYPE_SHOP_DEFAULT)).toBe(
      'both'
    );
    expect(resolvePackStockMode(99, null)).toBe('both');
  });
});

describe('derivePackAvailability', () => {
  it('should report the minimum implied by the components', () => {
    const derived = derivePackAvailability(
      [component('11', 1), component('12', 1)],
      availability([
        ['11', null, 9],
        ['12', null, 4],
      ])
    );

    expect(derived).toBe(4);
  });

  it('should floor a component quantity that does not divide evenly', () => {
    // 7 units of a component consumed 2 at a time assemble 3 packs; the eighth
    // unit does not exist, so 3.5 would be a quantity nobody can buy.
    expect(derivePackAvailability([component('11', 2)], availability([['11', null, 7]]))).toBe(3);
  });

  it('should report zero when a component has zero stock', () => {
    expect(
      derivePackAvailability(
        [component('11', 1), component('12', 2)],
        availability([
          ['11', null, 100],
          ['12', null, 0],
        ])
      )
    ).toBe(0);
  });

  it('should report zero when a component is oversold to a negative quantity', () => {
    // PrestaShop allows a negative stock_available when backorders are on. It
    // means "less than nothing on the shelf", never "negative packs".
    expect(derivePackAvailability([component('11', 1)], availability([['11', null, -5]]))).toBe(0);
  });

  it('should count a component with no stock row as zero, as PrestaShop does', () => {
    expect(derivePackAvailability([component('11', 1)], availability([]))).toBe(0);
  });

  it('should read a component keyed to a combination from that combination row', () => {
    const derived = derivePackAvailability(
      [component('11', 1, '55')],
      availability([
        ['11', null, 80],
        ['11', '55', 3],
      ])
    );

    expect(derived).toBe(3);
  });

  it('should return null - not zero - for a pack with no components', () => {
    // A derivation with no inputs is not the shop reporting a sell-out, and
    // zero here would silently pause every offer of a misconfigured pack.
    expect(derivePackAvailability([], availability([]))).toBeNull();
  });
});
