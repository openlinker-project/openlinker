/**
 * Listings list config (#4241)
 *
 * What the Listings list declares to the saved-views engine: the lifecycle
 * vocabulary the URL speaks, the filters a view may carry, the built-in views
 * and the column registry. The list has no sort anywhere (UI or API), so it
 * declares none and the engine keeps `sort` out of the address.
 *
 * Cell renderers belong to the page, so the registry is a factory taking them.
 *
 * @module apps/web/src/features/listings/lib
 */
import type { ReactNode } from 'react';
import type { ListRegistry, SystemViewDef } from '../../saved-views';
import { withColumnLayout } from '../../saved-views';
import type { OfferLifecycle, OfferMapping } from '../api/listings.types';

/**
 * Lowercase URL-state token for each lifecycle bucket (#2029). Kept distinct
 * from the PascalCase `OfferLifecycle` the API speaks, mirroring the existing
 * `?health=` convention of a lowercase URL param.
 */
export const LIFECYCLE_TAB_VALUES = ['active', 'invalid', 'draft', 'ended', 'unsynced'] as const;
export type LifecycleTab = (typeof LIFECYCLE_TAB_VALUES)[number];

export const DEFAULT_TAB: LifecycleTab = 'active';

/** Type-guard for the `tab` URL param. */
export function isLifecycleTab(value: string | null): value is LifecycleTab {
  return value !== null && (LIFECYCLE_TAB_VALUES as readonly string[]).includes(value);
}

/** One entry per lifecycle tab: its URL token and the `OfferLifecycle` it filters by. */
export interface LifecycleTabDef {
  key: LifecycleTab;
  lifecycle: OfferLifecycle;
}

export const LIFECYCLE_TABS: readonly LifecycleTabDef[] = [
  { key: 'active', lifecycle: 'Active' },
  // Named `invalid`/`Invalid`, not `inactive`/`Inactive` (#2032 review thread 9):
  // Allegro's own INACTIVE means "not live", which this bucket is not.
  { key: 'invalid', lifecycle: 'Invalid' },
  { key: 'draft', lifecycle: 'Draft' },
  { key: 'ended', lifecycle: 'Ended' },
  { key: 'unsynced', lifecycle: 'Unsynced' },
];

/**
 * The param that carries the applied saved view's id. The page's own `view`
 * param (All listings / Price changes) is a mode switch, never part of a view.
 */
export const LISTINGS_SAVED_VIEW_PARAM = 'savedView';

/** URL params that belong to the moment or to the page's mode, never to a view. */
const LISTINGS_NON_VIEW_PARAMS: string[] = [
  LISTINGS_SAVED_VIEW_PARAM,
  // Retired filter that an old bookmark can still carry; the table no longer applies it.
  'platformType',
  // Scopes the price-changes queue (a mode of the page), not the listings table.
  'queueConn',
];

/** Ids of the two "needs a look" built-in views. */
export const SELLING_DELETED_VIEW_ID = 'selling-deleted';
export const SHOP_BLOCKED_VIEW_ID = 'shop-blocked';

export interface ListingsListConfigInput {
  labels: {
    listing: string;
    listingFields: string;
    channel: string;
    connection: string;
    price: string;
    quantity: string;
    updated: string;
  };
  /** Operator names of the built-in views. */
  viewNames: Record<LifecycleTab, string> & { sellingDeleted: string; shopBlocked: string };
  headers: {
    listing: ReactNode;
    channel: ReactNode;
    connection: ReactNode;
    price: ReactNode;
    quantity: ReactNode;
    updated: ReactNode;
  };
  cells: {
    listing: (row: OfferMapping) => ReactNode;
    channel: (row: OfferMapping) => ReactNode;
    connection: (row: OfferMapping) => ReactNode;
    price: (row: OfferMapping) => ReactNode;
    quantity: (row: OfferMapping) => ReactNode;
    updated: (row: OfferMapping) => ReactNode;
  };
}

const TAB_TONE: Partial<Record<LifecycleTab, 'error' | 'warning'>> = {
  invalid: 'error',
  draft: 'warning',
};

export function listingsSystemViews(names: ListingsListConfigInput['viewNames']): SystemViewDef[] {
  return [
    ...LIFECYCLE_TABS.map(
      (def): SystemViewDef => ({
        id: def.key,
        name: names[def.key],
        query: def.key === DEFAULT_TAB ? '' : `tab=${def.key}`,
        tone: TAB_TONE[def.key],
      }),
    ),
    { id: SELLING_DELETED_VIEW_ID, name: names.sellingDeleted, query: 'staleSignal=selling', tone: 'error' },
    { id: SHOP_BLOCKED_VIEW_ID, name: names.shopBlocked, query: 'shopBlocked=true', tone: 'warning' },
  ];
}

/** Text lines the stacked cells render at their tallest, for the loading skeleton. */
const LISTING_COLUMN_LINES: Readonly<Record<string, number>> = { listing: 2, connection: 2 };


export function createListingsListRegistry(input: ListingsListConfigInput): ListRegistry<OfferMapping> {
  const { labels, headers, cells } = input;
  return {
    pageKey: 'listings',
    locked: {
      id: 'listing',
      label: labels.listing,
      description: labels.listingFields,
      header: headers.listing,
      render: cells.listing,
      width: '40%',
    },
    columns: withColumnLayout([
      { id: 'channel', label: labels.channel, defaultVisible: true, width: '9%', header: headers.channel, render: cells.channel },
      { id: 'connection', label: labels.connection, defaultVisible: true, width: '13%', header: headers.connection, render: cells.connection },
      { id: 'price', label: labels.price, defaultVisible: true, width: '12%', align: 'right', header: headers.price, render: cells.price },
      { id: 'quantity', label: labels.quantity, defaultVisible: true, width: '10%', align: 'right', header: headers.quantity, render: cells.quantity },
      { id: 'updated', label: labels.updated, defaultVisible: true, width: '12%', header: headers.updated, render: cells.updated },
    ], { lines: LISTING_COLUMN_LINES }),
    filters: [
      { key: 'tab', parse: (raw) => isLifecycleTab(raw) },
      { key: 'connectionId' },
      { key: 'staleSignal', parse: (raw) => raw === 'selling' },
      { key: 'shopBlocked', parse: (raw) => raw === 'true' },
    ],
    // No list sort exists in the UI or the API, so the engine offers none and keeps `sort` out of the address.
    sorts: [],
    defaultSort: { key: 'updated', dir: 'desc' },
    systemViews: listingsSystemViews(input.viewNames),
    pinned: LIFECYCLE_TABS.map((def) => def.key),
    lockedViewIds: LIFECYCLE_TABS.map((def) => def.key),
    extraNonViewParams: LISTINGS_NON_VIEW_PARAMS,
    viewParam: LISTINGS_SAVED_VIEW_PARAM,
  };
}
