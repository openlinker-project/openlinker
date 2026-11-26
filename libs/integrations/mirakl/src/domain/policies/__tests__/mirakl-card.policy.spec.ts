/**
 * Mirakl Card Policy: unit tests
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import type { CategoryParameter } from '@openlinker/core/listings';
import { empikOperatorProfile } from '../../../operators/empik.profile';
import {
  buildMiraklCardFile,
  buildMiraklCardRow,
  isMiraklCardAttributeFilledByOpenLinker,
  type MiraklCardInput,
} from '../mirakl-card.policy';

const CODES = empikOperatorProfile.cardAttributes;

function attribute(id: string, overrides: Partial<CategoryParameter> = {}): CategoryParameter {
  return {
    id,
    name: id,
    type: 'string',
    required: false,
    restrictions: {},
    section: 'product',
    ...overrides,
  };
}

const VAT = attribute('VAT_VALUE', {
  type: 'dictionary',
  required: true,
  dictionary: [
    { id: '4', value: 'zwolniony' },
    { id: '7', value: '23%' },
    { id: '8', value: '8%' },
    { id: '20', value: '0% techniczne' },
    { id: '3', value: '0%' },
  ],
});

function input(overrides: Partial<MiraklCardInput> = {}): MiraklCardInput {
  return {
    brand: 'Empik',
    codes: CODES,
    attributes: [VAT],
    categoryId: 'CAT-1',
    catalogCode: 'OL-1',
    ean: '5901234000031',
    title: 'Koszulka',
    description: 'Opis',
    imageUrls: ['https://img/1.jpg'],
    taxRate: '23',
    parameters: [],
    ...overrides,
  };
}

describe('isMiraklCardAttributeFilledByOpenLinker', () => {
  it('should hide the attributes OpenLinker fills and keep the rest', () => {
    for (const code of [
      'STR_GOLD',
      'CATALOG_CODE',
      'PELNY_TYTUL',
      'VAT_VALUE',
      'DODATKOWE_ZDJECIA_7',
      '650',
      '2039',
    ]) {
      expect(isMiraklCardAttributeFilledByOpenLinker(code, CODES)).toBe(true);
    }
    expect(isMiraklCardAttributeFilledByOpenLinker('2100', CODES)).toBe(false);
  });
});

describe('buildMiraklCardRow', () => {
  it('should map the VAT rate by its label, telling 0% apart from 0% techniczne', () => {
    expect(buildMiraklCardRow(input({ taxRate: '23' })).row.VAT_VALUE).toBe('7');
    expect(buildMiraklCardRow(input({ taxRate: '0' })).row.VAT_VALUE).toBe('3');
    expect(buildMiraklCardRow(input({ taxRate: 'zw' })).row.VAT_VALUE).toBe('4');
  });

  it('should refuse a VAT rate the list does not have, and a missing one when required', () => {
    expect(buildMiraklCardRow(input({ taxRate: '7' })).errors.map((e) => e.code)).toEqual([
      'MIRAKL_CARD_VAT_UNKNOWN',
      'MIRAKL_CARD_ATTRIBUTE_REQUIRED',
    ]);
    expect(buildMiraklCardRow(input({ taxRate: undefined })).errors.map((e) => e.code)).toEqual([
      'MIRAKL_CARD_ATTRIBUTE_REQUIRED',
    ]);
  });

  it('should send a LIST value as its code, by id or by label, joined for several values', () => {
    const colour = attribute('COLOUR', {
      type: 'dictionary',
      dictionary: [
        { id: 'R', value: 'Czerwony' },
        { id: 'B', value: 'Niebieski' },
      ],
    });
    const built = buildMiraklCardRow(
      input({
        attributes: [VAT, colour],
        parameters: [{ id: 'COLOUR', values: ['czerwony'], valuesIds: ['B'], section: 'product' }],
      })
    );

    expect(built.row.COLOUR).toBe('B|R');
    expect(built.errors).toEqual([]);
  });

  it('should refuse a value the list does not contain', () => {
    const colour = attribute('COLOUR', {
      type: 'dictionary',
      dictionary: [{ id: 'R', value: 'Czerwony' }],
    });

    const built = buildMiraklCardRow(
      input({
        attributes: [VAT, colour],
        parameters: [{ id: 'COLOUR', values: ['Zielony'], section: 'product' }],
      })
    );

    expect(built.errors).toEqual([
      expect.objectContaining({
        code: 'MIRAKL_CARD_VALUE_NOT_IN_LIST',
        field: 'parameters.COLOUR',
      }),
    ]);
  });

  it('should not let a parameter overwrite an attribute OpenLinker fills', () => {
    const built = buildMiraklCardRow(
      input({ parameters: [{ id: 'PELNY_TYTUL', values: ['Inny'], section: 'product' }] })
    );

    expect(built.row.PELNY_TYTUL).toBe('Koszulka');
  });

  it('should group variants and mark a set or a multipack where the category has the attributes', () => {
    const attributes = [
      VAT,
      attribute('VARIANT_GROUP_MKPL'),
      attribute('650', {
        type: 'dictionary',
        dictionary: [
          { id: 'Y', value: 'Tak' },
          { id: 'N', value: 'Nie' },
        ],
      }),
      attribute('ADRU'),
      attribute('2039', { type: 'integer' }),
    ];
    const component = {
      variantId: 'v',
      productId: 'p',
      name: 'Kubek',
      barcode: null,
      imageUrls: [],
    };

    const set = buildMiraklCardRow(
      input({
        attributes,
        variantGroup: { groupId: 'ol_product_1', attributes: [] },
        productSet: [
          { ...component, quantity: 2 },
          { ...component, name: 'Talerz', quantity: 1 },
        ],
      })
    ).row;
    const multipack = buildMiraklCardRow(
      input({ attributes, productSet: [{ ...component, quantity: 6 }] })
    ).row;

    expect(set).toMatchObject({
      VARIANT_GROUP_MKPL: 'ol_product_1',
      '650': 'Y',
      ADRU: '2 x Kubek, 1 x Talerz',
    });
    expect(set['2039']).toBeUndefined();
    expect(multipack).toMatchObject({ '2039': '6' });
    expect(multipack['650']).toBeUndefined();
  });

  it('should put extra images in the numbered columns up to the operator limit', () => {
    const urls = Array.from({ length: 13 }, (_, i) => `https://img/${i}.jpg`);
    const row = buildMiraklCardRow(input({ imageUrls: urls })).row;

    expect(row.ZDJECIE_OKLADKI_PRZOD_DUZY).toBe('https://img/0.jpg');
    expect(row.DODATKOWE_ZDJECIA_10).toBe('https://img/10.jpg');
    expect(row.DODATKOWE_ZDJECIA_11).toBeUndefined();
  });
});

describe('buildMiraklCardFile', () => {
  it('should write one column per attribute used, catalogue code first, quoting where needed', () => {
    const file = buildMiraklCardFile(
      [
        { STR_GOLD: 'C', CATALOG_CODE: 'OL-1', OPIS_PRODUKTU_PELNY: 'a;b' },
        { CATALOG_CODE: 'OL-2', PELNY_TYTUL: 'Tytuł "x"' },
      ],
      CODES
    );

    expect(file).toBe(
      'CATALOG_CODE;STR_GOLD;OPIS_PRODUKTU_PELNY;PELNY_TYTUL\n' +
        'OL-1;C;"a;b";\n' +
        'OL-2;;;"Tytuł ""x"""\n'
    );
  });
});
