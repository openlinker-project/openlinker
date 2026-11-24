import { toPackQuantity } from '../allegro-pack-quantity.mapper';

describe('toPackQuantity (#3929)', () => {
  it('returns the per-set unit count for a multipack productSet', () => {
    expect(
      toPackQuantity({ products: [{ id: '9d689aa5-0000-0000-0000-000000000001', quantity: 3 }] })
    ).toBe(3);
  });

  it('sums repeated entries of the same product', () => {
    expect(toPackQuantity({ products: [{ id: 'a', quantity: 1 }, { id: 'a', quantity: 2 }] })).toBe(
      3
    );
  });

  it('leaves a set of different products absent, since that is a bundle', () => {
    expect(
      toPackQuantity({ products: [{ id: 'phone', quantity: 1 }, { id: 'case', quantity: 1 }] })
    ).toBeUndefined();
  });

  it('leaves a product-set offer published from a bundle absent even with component quantities above one (#3520)', () => {
    expect(
      toPackQuantity({ products: [{ id: 'mug', quantity: 2 }, { id: 'spoon', quantity: 1 }] })
    ).toBeUndefined();
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['no products', {}],
    ['empty products', { products: [] }],
    ['a set of exactly one', { products: [{ quantity: 1 }] }],
    ['a malformed quantity', { products: [{ quantity: 'x' as unknown as number }] }],
    ['a zero quantity', { products: [{ quantity: 0 }] }],
    ['a missing id', { products: [{ quantity: 2 }] }],
    ['an empty id', { products: [{ id: '', quantity: 2 }] }],
    ['a non-string id', { products: [{ id: 5 as unknown as string, quantity: 2 }, { id: 5 as unknown as string, quantity: 2 }] }],
  ])('reads %s as an ordinary line', (_label, productSet) => {
    expect(toPackQuantity(productSet)).toBeUndefined();
  });
});
