import {
  MAP_CONTEXT,
  SHOP_HOST,
  buildProduct,
  buildStock,
} from '../../__tests__/shoper-test-data';
import {
  buildShoperImageUrl,
  mapShoperProduct,
  mapShoperStockToVariant,
  parseShoperNumber,
  pickShoperTranslation,
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
