/**
 * Products list config (#4241)
 *
 * What the Products list declares to the saved-views engine: the filters a view
 * may carry, the built-in views (the stock tabs plus the tax-rate gap), the
 * sorts and the column registry.
 *
 * Two params the page owns stay OUT of a view on purpose. `hideStale` is not the
 * name the list API validates a stored query against (`hideFullyStale`), so a
 * view carrying it would be refused on save; and `peek` and the legacy `dir`
 * are the moment's state, not a filter.
 *
 * Cell renderers belong to the page, so the registry is a factory taking them.
 *
 * @module apps/web/src/features/products/lib
 */
import type { ReactNode } from 'react';
import type { ListRegistry, SystemViewDef, ViewHeaderContext } from '../../saved-views';
import { withColumnLayout } from '../../saved-views';
import {
  ProductListSortFieldValues,
  ProductStockFilterValues,
  type Product,
  type ProductListSortDir,
  type ProductListSortField,
} from '../api/products.types';

export const DEFAULT_PRODUCT_SORT: ProductListSortField = 'createdAt';

/** First-click direction per sort key; re-clicking the active column flips it. */
export const DEFAULT_PRODUCT_SORT_DIR: Record<ProductListSortField, ProductListSortDir> = {
  name: 'asc',
  sku: 'asc',
  price: 'desc',
  createdAt: 'desc',
  updatedAt: 'desc',
  stock: 'asc',
};

/** Sort menu entries in menu order; `createdAt` (newest first) is the default. */
export const PRODUCT_SORT_KEYS: readonly ProductListSortField[] = [
  'createdAt',
  'updatedAt',
  'name',
  'sku',
  'price',
  'stock',
];

/** Params that belong to the moment or to the page, never to a view. */
const PRODUCTS_NON_VIEW_PARAMS: string[] = ['dir', 'peek', 'hideStale'];

/** Ids of the built-in views. */
export const PRODUCT_VIEW_IDS = { all: 'all', out: 'out', low: 'low', oversold: 'oversold', noTax: 'no-tax-rate' } as const;

/** Text lines the stacked cells render at their tallest, for the loading skeleton. */
const PRODUCT_COLUMN_LINES: Readonly<Record<string, number>> = { name: 2, source: 2 };

/** Breakpoints the table already hid these columns at; the registry has none, so the page re-applies them. */
const PRODUCT_COLUMN_HIDE_BELOW: Readonly<Record<string, 480 | 768 | 1024 | 1280>> = {
  source: 1024,
  money: 480,
};

export interface ProductsListConfigInput {
  /** The tax-rate view only means anything where a shop can be asked for a rate. */
  showTaxView: boolean;
  labels: {
    product: string;
    productFields: string;
    source: string;
    sourceFields: string;
    stock: string;
    listings: string;
    money: string;
    price: string;
    updated: string;
    moneyUpdated: string;
    created: string;
    sku: string;
  };
  viewNames: { all: string; out: string; low: string; oversold: string; noTaxRate: string };
  sortLabels: Record<ProductListSortField, string>;
  /** The locked Product header carries two sort buttons (name and SKU), so it is built from the engine's header context. */
  lockedHeader: (context: ViewHeaderContext) => ReactNode;
  cells: {
    product: (row: Product) => ReactNode;
    source: (row: Product) => ReactNode;
    stock: (row: Product) => ReactNode;
    listings: (row: Product) => ReactNode;
    price: (row: Product) => ReactNode;
    updated: (row: Product) => ReactNode;
    created: (row: Product) => ReactNode;
  };
}

export function productsSystemViews(
  names: ProductsListConfigInput['viewNames'],
  showTaxView: boolean,
): SystemViewDef[] {
  return [
    { id: PRODUCT_VIEW_IDS.all, name: names.all, query: '' },
    { id: PRODUCT_VIEW_IDS.out, name: names.out, query: 'stock=out', tone: 'error' },
    { id: PRODUCT_VIEW_IDS.low, name: names.low, query: 'stock=low', tone: 'warning' },
    { id: PRODUCT_VIEW_IDS.oversold, name: names.oversold, query: 'stock=oversold', tone: 'error' },
    ...(showTaxView ? [{ id: PRODUCT_VIEW_IDS.noTax, name: names.noTaxRate, query: 'taxRateState=missing' }] : []),
  ];
}

export function createProductsListRegistry(input: ProductsListConfigInput): ListRegistry<Product> {
  const { labels, cells } = input;
  return {
    pageKey: 'products',
    locked: {
      id: 'name',
      label: labels.product,
      description: labels.productFields,
      header: input.lockedHeader,
      sortKeys: ['name', 'sku'],
      render: cells.product,
      width: '29%',
    },
    columns: withColumnLayout([
      { id: 'source', label: labels.source, description: labels.sourceFields, defaultVisible: true, width: '14%', header: labels.source, render: cells.source },
      { id: 'stock', label: labels.stock, defaultVisible: true, width: '16%', header: labels.stock, sortKey: 'stock', render: cells.stock },
      { id: 'listings', label: labels.listings, defaultVisible: true, width: '19%', header: labels.listings, render: cells.listings },
      {
        id: 'money',
        label: labels.money,
        defaultVisible: true,
        width: '14%',
        align: 'right',
        parts: [
          { id: 'price', label: labels.price, sort: 'price', headerLabel: labels.price, render: cells.price },
          { id: 'updated', label: labels.moneyUpdated, sort: 'updatedAt', headerLabel: labels.updated, render: cells.updated },
          { id: 'created', label: labels.created, sort: 'createdAt', headerLabel: labels.created, render: cells.created },
        ],
      },
    ], { hideBelow: PRODUCT_COLUMN_HIDE_BELOW, lines: PRODUCT_COLUMN_LINES }),
    filters: [
      { key: 'stock', parse: (raw) => (ProductStockFilterValues as readonly string[]).includes(raw) },
      { key: 'taxRateState', parse: (raw) => ['missing', 'not-checked', 'known'].includes(raw) },
      { key: 'unlistedOn' },
      { key: 'connectionId' },
      { key: 'bundles', parse: (raw) => ['only', 'exclude', 'true'].includes(raw) },
    ],
    sorts: PRODUCT_SORT_KEYS.map((key) => ({
      key,
      dir: DEFAULT_PRODUCT_SORT_DIR[key],
      label: input.sortLabels[key],
    })),
    defaultSort: { key: DEFAULT_PRODUCT_SORT, dir: DEFAULT_PRODUCT_SORT_DIR[DEFAULT_PRODUCT_SORT] },
    systemViews: productsSystemViews(input.viewNames, input.showTaxView),
    pinned: Object.values(PRODUCT_VIEW_IDS),
    lockedViewIds: [PRODUCT_VIEW_IDS.all, PRODUCT_VIEW_IDS.out],
    extraNonViewParams: PRODUCTS_NON_VIEW_PARAMS,
  };
}

/** Narrows a raw `sort` param to a sort field the list API knows. */
export function isProductSortField(value: string | null | undefined): value is ProductListSortField {
  return value !== null && value !== undefined && (ProductListSortFieldValues as readonly string[]).includes(value);
}
