/**
 * Test data builders shaped like payloads captured from a live Shoper trial
 * shop (1 Oct 2026). Every numeric field is a string, as on the wire.
 *
 * The option fixtures at the bottom ARE live-captured (product 127, 5 Oct 2026,
 * read-only GETs): a stock's `options` is `{ option_id: ovalue_id }`, ids only.
 */
import type {
  ShoperOption,
  ShoperOptionValue,
  ShoperProduct,
  ShoperStock,
} from '../../domain/types/shoper-api.types';
import type { ShoperMapContext } from '../mappers/shoper-product.mapper';

export const SHOP_HOST = 'sklep729770.shoparena.pl';

export const MAP_CONTEXT: ShoperMapContext = {
  host: SHOP_HOST,
  language: 'pl_PL',
  currency: 'PLN',
  weightUnit: 'KILOGRAM',
  warehousesEnabled: false,
  decrementsStockOnOrder: true,
};

export function buildStock(overrides: Partial<ShoperStock> = {}): ShoperStock {
  return {
    stock_id: '181',
    product_id: '93',
    price: '1484.28',
    stock: '74',
    weight: '1',
    active: '1',
    default: '1',
    code: '3505-4890F',
    ean: '5901234123457',
    options: [],
    ...overrides,
  };
}

export function buildProduct(overrides: Partial<ShoperProduct> = {}): ShoperProduct {
  return {
    product_id: '93',
    tax_id: '1',
    code: '3505-4890F',
    ean: '5901234123457',
    category_id: '38',
    categories: [38],
    translations: {
      pl_PL: {
        name: 'Ceramiczny zestaw naczyń Sandstone Freckless',
        description: '<p>Opis</p>',
        short_description: '',
      },
      en_US: {
        name: 'Sandstone Freckless Ceramic Dish Set',
        description: '<p>Description</p>',
        short_description: '',
      },
    },
    main_image: { unic_name: '207', extension: 'png' },
    stock: buildStock(),
    options: [],
    ...overrides,
  };
}

/** Shoper list envelope: `count` is a string, `pages` / `page` are numbers. */
export function envelope<T>(
  list: readonly T[],
  paging: { count?: number; pages?: number; page?: number } = {},
): { count: string; pages: number; page: number; list: readonly T[] } {
  return {
    count: String(paging.count ?? list.length),
    pages: paging.pages ?? 1,
    page: paging.page ?? 1,
    list,
  };
}

/** `GET /options/10`, as captured. */
export const LIVE_OPTION_COLOUR: ShoperOption = {
  option_id: '10',
  translations: { pl_PL: { name: 'Kolor' } },
};

/** Two of the values `GET /option-values?filters[option_id]=10` returned, as captured. */
export const LIVE_OPTION_VALUES: readonly ShoperOptionValue[] = [
  { ovalue_id: '68', option_id: '10', translations: { pl_PL: { value: 'biszkoptowy' } } },
  { ovalue_id: '76', option_id: '10', translations: { pl_PL: { value: 'Shoper blue' } } },
];

/** The three `product-stocks` rows of live product 127: one default with `[]`, two with `{ "10": id }`. */
export const LIVE_VARIANT_STOCKS: readonly ShoperStock[] = [
  buildStock({ stock_id: '215', product_id: '127', code: '1E72-8147C_20250917135829', ean: '', options: [] }),
  buildStock({ stock_id: '217', product_id: '127', code: '', ean: '', default: '0', options: { '10': '68' } }),
  buildStock({ stock_id: '218', product_id: '127', code: '', ean: '', default: '0', options: { '10': '76' } }),
];
