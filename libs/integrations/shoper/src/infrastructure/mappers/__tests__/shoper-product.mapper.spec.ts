import {
  LIVE_OPTION_COLOUR,
  LIVE_OPTION_VALUES,
  LIVE_VARIANT_STOCKS,
  MAP_CONTEXT,
  SHOP_HOST,
  buildProduct,
  buildStock,
} from '../../__tests__/shoper-test-data';
import type { ShoperOptionEntry } from '../../shop-context/shoper-option-table.provider';
import {
  buildShoperImageUrl,
  mapShoperProduct,
  mapShoperStockToVariant,
  parseShoperNumber,
  pickShoperTranslation,
  resolveShoperVariantAttributes,
  shoperStockOptionPairs,
} from '../shoper-product.mapper';

describe('parseShoperNumber', () => {
  it.each([
    ['1484.28', 1484.28],
    ['0', 0],
    [74, 74],
    ['0.00', 0],
  ])('should parse %p as %p, keeping zero', (raw, expected) => {
    expect(parseShoperNumber(raw)).toBe(expected);
  });

  it.each([[null], [undefined], [''], ['abc'], ['NaN']])(
    'should return undefined for %p',
    (raw) => {
      expect(parseShoperNumber(raw)).toBeUndefined();
    },
  );
});

describe('pickShoperTranslation', () => {
  const translations = {
    pl_PL: { name: 'Nazwa' },
    en_US: { name: 'Name' },
  };

  it('should prefer the shop default language', () => {
    expect(pickShoperTranslation(translations, 'en_US')?.name).toBe('Name');
  });

  it('should fall back to the first translation with a name when the default has none', () => {
    expect(pickShoperTranslation({ pl_PL: { name: '' }, en_US: { name: 'Name' } }, 'pl_PL')?.name).toBe(
      'Name',
    );
  });

  it('should return undefined when no translation has a name', () => {
    expect(pickShoperTranslation({ pl_PL: { name: null } }, 'pl_PL')).toBeUndefined();
    expect(pickShoperTranslation(undefined, 'pl_PL')).toBeUndefined();
  });
});

describe('buildShoperImageUrl', () => {
  it('should build the public gfx URL', () => {
    expect(buildShoperImageUrl(SHOP_HOST, { unic_name: '207', extension: 'png' })).toBe(
      'https://sklep729770.shoparena.pl/userdata/public/gfx/207.png',
    );
  });
});

describe('buildShoperImageUrl safety', () => {
  it.each([
    ['a path separator', { unic_name: '207/../../x', extension: 'png' }],
    ['a query', { unic_name: '207?x=1', extension: 'png' }],
    ['a fragment', { unic_name: '207#x', extension: 'png' }],
    ['a leading dot', { unic_name: '..', extension: 'png' }],
    ['an empty name', { unic_name: '', extension: 'png' }],
    ['a dotted extension', { unic_name: '207', extension: 'png/x' }],
    ['an empty extension', { unic_name: '207', extension: '' }],
    ['whitespace', { unic_name: '20 7', extension: 'png' }],
  ])('should refuse a file name containing %s, rather than address another resource', (_l, image) => {
    expect(buildShoperImageUrl(SHOP_HOST, image)).toBeNull();
  });

  it('should accept ordinary stems, including dots and dashes inside', () => {
    expect(buildShoperImageUrl(SHOP_HOST, { unic_name: '207-a.b_c', extension: 'webp' })).toBe(
      'https://sklep729770.shoparena.pl/userdata/public/gfx/207-a.b_c.webp',
    );
  });

  it('should leave a product without an image when the file name is unsafe', () => {
    const product = mapShoperProduct(
      buildProduct({ main_image: { unic_name: '../x', extension: 'png' } }),
      MAP_CONTEXT,
    );
    expect(product.images).toBeNull();
  });
});

describe('mapShoperStockToVariant', () => {
  it('should map the variant grain: sku, EAN, price and weight', () => {
    expect(mapShoperStockToVariant(buildStock(), 'ol_product_1', MAP_CONTEXT)).toEqual({
      productId: 'ol_product_1',
      sku: '3505-4890F',
      attributes: null,
      ean: '5901234123457',
      gtin: '5901234123457',
      price: 1484.28,
      weight: 1,
      weightGrams: 1000,
    });
  });

  it.each([[null], [''], ['   ']])('should map an empty EAN %p to null, never to ""', (ean) => {
    const variant = mapShoperStockToVariant(buildStock({ ean }), 'p', MAP_CONTEXT);
    expect(variant.ean).toBeNull();
    expect(variant.gtin).toBeNull();
  });

  it('should map an empty code to a null sku', () => {
    expect(mapShoperStockToVariant(buildStock({ code: '' }), 'p', MAP_CONTEXT).sku).toBeNull();
  });

  it('should keep a zero price rather than dropping it', () => {
    expect(mapShoperStockToVariant(buildStock({ price: '0.00' }), 'p', MAP_CONTEXT).price).toBe(0);
  });

  it('should omit price and weight when the shop sent none', () => {
    const variant = mapShoperStockToVariant(buildStock({ price: null, weight: null }), 'p', MAP_CONTEXT);
    expect(variant).not.toHaveProperty('price');
    expect(variant).not.toHaveProperty('weight');
    expect(variant).not.toHaveProperty('weightGrams');
  });

  it('should leave weight unset for a unit it cannot convert with confidence', () => {
    const variant = mapShoperStockToVariant(buildStock({ weight: '500' }), 'p', {
      ...MAP_CONTEXT,
      weightUnit: 'GRAM',
    });
    expect(variant).not.toHaveProperty('weight');
  });

  it('should give each stock row of a multi-variant product its own variant', () => {
    const rows = [
      buildStock({ stock_id: '300', code: 'SKU-S', ean: '' }),
      buildStock({ stock_id: '301', code: 'SKU-M', ean: '5901234123464' }),
    ];
    const variants = rows.map((r) => mapShoperStockToVariant(r, 'p', MAP_CONTEXT));
    expect(variants.map((v) => v.sku)).toEqual(['SKU-S', 'SKU-M']);
    expect(variants.map((v) => v.ean)).toEqual([null, '5901234123464']);
  });
});

describe('mapShoperProduct', () => {
  it('should map a live-shaped product', () => {
    expect(mapShoperProduct(buildProduct(), MAP_CONTEXT)).toEqual({
      name: 'Ceramiczny zestaw naczyń Sandstone Freckless',
      sku: '3505-4890F',
      price: 1484.28,
      description: '<p>Opis</p>',
      images: ['https://sklep729770.shoparena.pl/userdata/public/gfx/207.png'],
      currency: 'PLN',
      categories: ['38'],
      weight: 1,
    });
  });

  it('should use the configured default language, not isdefault', () => {
    const product = mapShoperProduct(buildProduct(), { ...MAP_CONTEXT, language: 'en_US' });
    expect(product.name).toBe('Sandstone Freckless Ceramic Dish Set');
  });

  it('should fall back to the sku, then a synthetic name, when no translation has a name', () => {
    expect(mapShoperProduct(buildProduct({ translations: {} }), MAP_CONTEXT).name).toBe('3505-4890F');
    expect(
      mapShoperProduct(buildProduct({ translations: {}, code: '' }), MAP_CONTEXT).name,
    ).toBe('product-93');
  });

  it('should map empty description and missing image to null', () => {
    const product = mapShoperProduct(
      buildProduct({
        main_image: null,
        translations: { pl_PL: { name: 'N', description: '' } },
      }),
      MAP_CONTEXT,
    );
    expect(product.description).toBeNull();
    expect(product.images).toBeNull();
  });

  it('should tolerate a product with no stock row', () => {
    const product = mapShoperProduct(buildProduct({ stock: null }), MAP_CONTEXT);
    expect(product.price).toBeNull();
    expect(product).not.toHaveProperty('weight');
  });

  it('should not invent createdAt / updatedAt from zone-less shop timestamps', () => {
    const product = mapShoperProduct(buildProduct(), MAP_CONTEXT);
    expect(product).not.toHaveProperty('createdAt');
    expect(product).not.toHaveProperty('updatedAt');
  });
});

describe('shoperStockOptionPairs', () => {
  it('should read the live {option_id: value_id} object into pairs', () => {
    expect(shoperStockOptionPairs(LIVE_VARIANT_STOCKS[1].options)).toEqual([['10', '68']]);
  });

  it.each([[[]], [{}], [null], [undefined]])('should treat %p as no options, not as malformed', (options) => {
    expect(shoperStockOptionPairs(options as never)).toEqual([]);
  });

  it.each([[[1, 2]], ['x'], [{ '10': 68 }], [{ Kolor: '68' }], [{ '10': '' }]])(
    'should report %p as malformed',
    (options) => {
      expect(shoperStockOptionPairs(options as never)).toBe('malformed');
    },
  );
});

describe('resolveShoperVariantAttributes', () => {
  const colour: ShoperOptionEntry = {
    option: LIVE_OPTION_COLOUR,
    values: new Map(LIVE_OPTION_VALUES.map((v) => [v.ovalue_id, v])),
  };
  const entries = new Map<string, ShoperOptionEntry | null>([['10', colour]]);

  it('should resolve the live option and value ids to their names', () => {
    expect(resolveShoperVariantAttributes(LIVE_VARIANT_STOCKS[1].options, entries, 'pl_PL')).toEqual({
      attributes: { Kolor: 'biszkoptowy' },
    });
    expect(resolveShoperVariantAttributes(LIVE_VARIANT_STOCKS[2].options, entries, 'pl_PL')).toEqual({
      attributes: { Kolor: 'Shoper blue' },
    });
  });

  it('should give a variant with no options null attributes and no problem', () => {
    expect(resolveShoperVariantAttributes(LIVE_VARIANT_STOCKS[0].options, entries, 'pl_PL')).toEqual({
      attributes: null,
    });
  });

  it('should fall back to another language when the shop language has no text', () => {
    const result = resolveShoperVariantAttributes({ '10': '68' }, entries, 'en_US');
    expect(result.attributes).toEqual({ Kolor: 'biszkoptowy' });
  });

  it.each([
    ['an option the shop does not know', { '99': '68' }],
    ['a value the option does not have', { '10': '999' }],
    ['a malformed options value', [1, 2]],
  ])('should give null attributes and a reason for %s', (_label, options) => {
    const result = resolveShoperVariantAttributes(options as never, entries, 'pl_PL');
    expect(result.attributes).toBeNull();
    expect(result.problem).toEqual(expect.any(String));
  });

  it('should give null attributes when the option read was untrusted (null entry)', () => {
    const result = resolveShoperVariantAttributes({ '10': '68' }, new Map([['10', null]]), 'pl_PL');
    expect(result.attributes).toBeNull();
    expect(result.problem).toContain('option 10');
  });

  it('should refuse a partial set when one of two options cannot be resolved', () => {
    const result = resolveShoperVariantAttributes({ '10': '68', '11': '83' }, entries, 'pl_PL');
    expect(result.attributes).toBeNull();
  });

  it('should refuse two options that share a name rather than overwrite one', () => {
    const other: ShoperOptionEntry = {
      option: { option_id: '13', translations: { pl_PL: { name: 'Kolor' } } },
      values: new Map([['5', { ovalue_id: '5', option_id: '13', translations: { pl_PL: { value: 'x' } } }]]),
    };
    const result = resolveShoperVariantAttributes(
      { '10': '68', '13': '5' },
      new Map([['10', colour], ['13', other]]),
      'pl_PL',
    );
    expect(result.attributes).toBeNull();
    expect(result.problem).toContain('"Kolor"');
  });
});

describe('mapShoperStockToVariant attributes', () => {
  it('should carry the resolved attributes onto the variant', () => {
    const variant = mapShoperStockToVariant(LIVE_VARIANT_STOCKS[1], 'p', MAP_CONTEXT, { Kolor: 'biszkoptowy' });
    expect(variant.attributes).toEqual({ Kolor: 'biszkoptowy' });
  });

  it('should default to null attributes', () => {
    expect(mapShoperStockToVariant(LIVE_VARIANT_STOCKS[0], 'p', MAP_CONTEXT).attributes).toBeNull();
  });
});
