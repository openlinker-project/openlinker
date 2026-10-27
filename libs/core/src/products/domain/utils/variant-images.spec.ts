import { normalizeVariantImages, resolveVariantDefaultImages } from './variant-images';

describe('normalizeVariantImages', () => {
  it('should keep the master order and drop blanks and repeats', () => {
    expect(normalizeVariantImages([' https://a/1.jpg ', '', 'https://a/2.jpg', 'https://a/1.jpg'])).toEqual([
      'https://a/1.jpg',
      'https://a/2.jpg',
    ]);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty list', []],
    ['only blanks', ['  ', '']],
  ])('should store %s as null', (_label, images) => {
    expect(normalizeVariantImages(images)).toBeNull();
  });
});

describe('resolveVariantDefaultImages', () => {
  const gfx = (id: number): string => `https://sklep729770.shoparena.pl/userdata/public/gfx/${id}.jpg`;

  /** Product 161 as synced: base stock gone (stale), four colour variants. */
  const base = { id: 'base', images: null, isStale: true };
  const red = { id: 'red', images: [gfx(314)], isStale: false };
  const green = { id: 'green', images: [gfx(315)], isStale: false };
  const navy = { id: 'navy', images: null, isStale: false };
  const yellow = { id: 'yellow', images: [gfx(314)], isStale: false };
  const P161_SIBLINGS = [base, red, green, navy, yellow];
  const P161_GALLERY = [gfx(312), gfx(313), gfx(314), gfx(315)];

  it.each([
    ['red', red, [gfx(314), gfx(312), gfx(313)]],
    ['yellow, which shares its picture with red', yellow, [gfx(314), gfx(312), gfx(313)]],
    ['green', green, [gfx(315), gfx(312), gfx(313)]],
    ['navy, which has no picture of its own', navy, [gfx(312), gfx(313)]],
  ])('should list %s with its own picture first and no sibling picture', (_label, variant, expected) => {
    expect(resolveVariantDefaultImages(variant, P161_SIBLINGS, P161_GALLERY)).toEqual(expected);
  });

  it('should list a simple product with the whole gallery (product 163)', () => {
    const only = { id: 'v271', images: null, isStale: false };
    expect(resolveVariantDefaultImages(only, [only], [gfx(318), gfx(319)])).toEqual([
      gfx(318),
      gfx(319),
    ]);
  });

  it('should list a single-variant product with its picture first, then the rest (product 162)', () => {
    const v270 = { id: 'v270', images: [gfx(317)], isStale: false };
    const staleBase = { id: 'v269', images: null, isStale: true };
    expect(resolveVariantDefaultImages(v270, [staleBase, v270], [gfx(316), gfx(317)])).toEqual([
      gfx(317),
      gfx(316),
    ]);
  });

  it('should not let a stale sibling claim a gallery image', () => {
    const gone = { id: 'gone', images: [gfx(313)], isStale: true };
    expect(resolveVariantDefaultImages(navy, [navy, gone], [gfx(312), gfx(313)])).toEqual([
      gfx(312),
      gfx(313),
    ]);
  });

  it('should fall back to the whole gallery when every image belongs to another variant', () => {
    const other = { id: 'other', images: [gfx(1), gfx(2)], isStale: false };
    expect(resolveVariantDefaultImages(navy, [navy, other], [gfx(1), gfx(2)])).toEqual([
      gfx(1),
      gfx(2),
    ]);
  });

  it('should keep the variant picture even when the product has no gallery', () => {
    expect(resolveVariantDefaultImages(red, [red], null)).toEqual([gfx(314)]);
  });

  it('should return null when neither the variant nor the product has an image', () => {
    expect(resolveVariantDefaultImages(navy, [navy], null)).toBeNull();
  });

  it('should not change anything for a master that reports no variant pictures', () => {
    const a = { id: 'a', images: undefined };
    const b = { id: 'b', images: undefined };
    expect(resolveVariantDefaultImages(a, [a, b], [gfx(1), gfx(2)])).toEqual([gfx(1), gfx(2)]);
  });
});
