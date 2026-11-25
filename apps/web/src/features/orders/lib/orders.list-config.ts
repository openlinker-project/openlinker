/**
 * Orders list config (#4241)
 *
 * What the Orders list declares to the saved-views engine: the filters a view
 * may carry, the built-in views (the five health buckets plus "All"), the sorts
 * and the column registry.
 *
 * Column ids are `ORDER_LIST_COLUMN_IDS` verbatim (customer, channel, status,
 * shipment, money): migration 1940100000000 copied every stored column preset
 * into saved views by those ids, so renaming one would orphan what it copied.
 *
 * Two spellings are NOT the engine's, and each has a codec so adopting views
 * changes no URL the app already produced or any stored query the list endpoint
 * would refuse:
 * - the sort is `sort=total&dir=asc` (two params), not `sort=total:asc`;
 * - six filter params are named for the operator (`invoicing=blocked`) while the
 *   list endpoint validates a stored query against its DTO names
 *   (`salesDocumentBlocked=true`).
 *
 * `due` (ship-by within 24 h) is deliberately outside every view: it is relative
 * to the moment it is read, and the endpoint's only spelling of it (`dueBefore`)
 * is an absolute instant, so a view carrying it would silently describe a
 * different window each day. `dir` and `peek` are the moment's state.
 *
 * Cell renderers belong to the page, so the registry is a factory taking them.
 *
 * @module apps/web/src/features/orders/lib
 */
import type { ReactNode } from 'react';
import type { ListRegistry, SortCodec, StoredQueryCodec, SystemViewDef } from '../../saved-views';
import {
  FulfillmentRollupStateValues,
  OrderHealthValues,
  OrderSortDirectionValues,
  OrderSortValues,
  SlaStateValues,
  type OrderHealthValue,
  type OrderRecord,
  type OrderSortDirection,
  type OrderSortValue,
} from '../api/orders.types';
import { isHoldReason } from './order-hold.types';
import { isOrderLifecyclePhase } from './order-lifecycle-phase';

/**
 * Default ordering (#4026): most recently synced into OpenLinker first. Placed
 * date (#4025) and ship-by soonest stay one click away in the Sort menu and on
 * their column headers.
 */
export const DEFAULT_ORDER_SORT: OrderSortValue = 'createdAt';

/**
 * First-click direction per sort key (#944): the operator-intuitive default
 * when a column is newly selected. Re-clicking the active column flips it.
 */
export const DEFAULT_ORDER_SORT_DIR: Record<OrderSortValue, OrderSortDirection> = {
  dispatchBy: 'asc',
  createdAt: 'desc',
  placedAt: 'desc',
  customer: 'asc',
  items: 'desc',
  status: 'asc',
  total: 'desc',
  fulfillment: 'asc',
  payment: 'asc',
};

export function isOrderSort(value: string | null): value is OrderSortValue {
  return value !== null && (OrderSortValues as readonly string[]).includes(value);
}

export function isOrderDir(value: string | null): value is OrderSortDirection {
  return value !== null && (OrderSortDirectionValues as readonly string[]).includes(value);
}

/** Sort menu entries in menu order; `createdAt` (recently synced) is the default. */
export const ORDER_SORT_KEYS = [
  'createdAt',
  'placedAt',
  'dispatchBy',
  'customer',
  'status',
  'fulfillment',
  'total',
  'payment',
] as const satisfies readonly OrderSortValue[];

/**
 * `sort` + `dir` as the list's URLs already spell them. A lone `dir` still means
 * "the default key, that direction" and a lone `sort` "that key, its first-click
 * direction", exactly as `useOrderListFilters` reads them, so a bookmark made
 * before views existed opens the same list.
 */
export const ORDER_SORT_CODEC: SortCodec = {
  parse: (params) => {
    const rawSort = params.get('sort');
    const rawDir = params.get('dir');
    if (rawSort === null && rawDir === null) return null;
    const key = isOrderSort(rawSort) ? rawSort : DEFAULT_ORDER_SORT;
    const dir = isOrderDir(rawDir) ? rawDir : DEFAULT_ORDER_SORT_DIR[key];
    return { key, dir };
  },
  write: (params, sort) => {
    params.delete('sort');
    params.delete('dir');
    if (!sort) return;
    params.set('sort', sort.key);
    params.set('dir', sort.dir);
  },
};

/** URL param to the name the list endpoint validates, for the toggles the URL names for the operator. */
const STORED_NAME_BY_URL_PARAM: Readonly<Record<string, { name: string; urlValue: string }>> = {
  invoicing: { name: 'salesDocumentBlocked', urlValue: 'blocked' },
  routing: { name: 'destinationRoutingBlocked', urlValue: 'blocked' },
  waiting: { name: 'waitingInOpenLinker', urlValue: 'true' },
  packBench: { name: 'onPackBench', urlValue: 'true' },
  taxRate: { name: 'taxRateConflict', urlValue: 'conflict' },
};

/**
 * Only the expected value is renamed. Any other value keeps its key, so the
 * endpoint refuses it by name instead of a stale link quietly becoming `true`.
 */
export const ORDER_STORED_QUERY_CODEC: StoredQueryCodec = {
  encode: (query) => {
    const next = new URLSearchParams();
    new URLSearchParams(query).forEach((value, key) => {
      const stored = STORED_NAME_BY_URL_PARAM[key];
      if (stored && value === stored.urlValue) next.append(stored.name, 'true');
      else next.append(key, value);
    });
    return next.toString();
  },
  decode: (query) => {
    const next = new URLSearchParams();
    new URLSearchParams(query).forEach((value, key) => {
      const url = Object.entries(STORED_NAME_BY_URL_PARAM).find(([, stored]) => stored.name === key);
      if (url && value === 'true') next.append(url[0], url[1].urlValue);
      else next.append(key, value);
    });
    return next.toString();
  },
};

/** Params that belong to the moment or to the page, never to a view. */
const ORDERS_NON_VIEW_PARAMS: string[] = ['dir', 'peek', 'due'];

/** Ids of the built-in views: "All" plus the health bucket each one filters to. */
export const ORDER_VIEW_IDS = {
  all: 'all',
  needsAttention: 'needs_attention',
  awaitingMapping: 'awaiting_mapping',
  awaitingDispatch: 'awaiting_dispatch',
  sourceDeleted: 'source_deleted',
  synced: 'synced',
} as const satisfies Record<string, 'all' | OrderHealthValue>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TOGGLE = (raw: string): boolean => raw === 'true';

/** The filters a view may carry, with the values each still accepts. */
const ORDER_VIEW_FILTERS: ListRegistry<OrderRecord>['filters'] = [
  { key: 'health', parse: (raw) => (OrderHealthValues as readonly string[]).includes(raw) },
  { key: 'phase', parse: (raw) => isOrderLifecyclePhase(raw) },
  { key: 'sourceConnectionId' },
  { key: 'createdFrom', parse: (raw) => DAY.test(raw) },
  { key: 'createdTo', parse: (raw) => DAY.test(raw) },
  { key: 'slaState', parse: (raw) => (SlaStateValues as readonly string[]).includes(raw) },
  { key: 'fulfillmentState', parse: (raw) => (FulfillmentRollupStateValues as readonly string[]).includes(raw) },
  { key: 'packed', parse: (raw) => raw === 'true' || raw === 'false' },
  { key: 'hold', parse: (raw) => isHoldReason(raw) },
  { key: 'invoicing', parse: (raw) => raw === 'blocked' },
  { key: 'routing', parse: (raw) => raw === 'blocked' },
  { key: 'taxRate', parse: (raw) => raw === 'conflict' },
  { key: 'attentionReason', parse: (raw) => raw === 'source-change-unapplied' },
  { key: 'attention', parse: TOGGLE },
  { key: 'paymentNotSent', parse: TOGGLE },
  { key: 'waiting', parse: TOGGLE },
  { key: 'packBench', parse: TOGGLE },
  { key: 'openReturn', parse: TOGGLE },
  { key: 'hasBuyerNote', parse: TOGGLE },
  { key: 'withGift', parse: TOGGLE },
  { key: 'withBundle', parse: TOGGLE },
  { key: 'giftNotAdded', parse: TOGGLE },
  { key: 'giftShopRejected', parse: TOGGLE },
  { key: 'tag' },
  { key: 'untagged', parse: TOGGLE },
];

export interface OrdersListConfigInput {
  labels: {
    order: string;
    orderFields: string;
    customer: string;
    customerName: string;
    customerCity: string;
    customerNote: string;
    channel: string;
    channelSource: string;
    channelDestination: string;
    status: string;
    statusFields: string;
    shipment: string;
    shipmentState: string;
    shipmentCarrier: string;
    shipBy: string;
    money: string;
    total: string;
    payment: string;
    document: string;
    placed: string;
    created: string;
  };
  viewNames: Record<(typeof ORDER_VIEW_IDS)[keyof typeof ORDER_VIEW_IDS], string>;
  sortLabels: Record<(typeof ORDER_SORT_KEYS)[number], string>;
  cells: {
    order: (row: OrderRecord) => ReactNode;
    customerName: (row: OrderRecord) => ReactNode;
    customerCity: (row: OrderRecord) => ReactNode;
    customerNote: (row: OrderRecord) => ReactNode;
    channelSource: (row: OrderRecord) => ReactNode;
    channelDestination: (row: OrderRecord) => ReactNode;
    status: (row: OrderRecord) => ReactNode;
    shipmentState: (row: OrderRecord) => ReactNode;
    shipmentCarrier: (row: OrderRecord) => ReactNode;
    moneyTotal: (row: OrderRecord) => ReactNode;
    moneyPayment: (row: OrderRecord) => ReactNode;
    moneyDocument: (row: OrderRecord) => ReactNode;
    moneyPlaced: (row: OrderRecord) => ReactNode;
    moneyCreated: (row: OrderRecord) => ReactNode;
  };
}

export function ordersSystemViews(names: OrdersListConfigInput['viewNames']): SystemViewDef[] {
  return [
    { id: ORDER_VIEW_IDS.all, name: names.all, query: '' },
    { id: ORDER_VIEW_IDS.needsAttention, name: names.needs_attention, query: 'health=needs_attention', tone: 'error' },
    { id: ORDER_VIEW_IDS.awaitingMapping, name: names.awaiting_mapping, query: 'health=awaiting_mapping', tone: 'warning' },
    {
      id: ORDER_VIEW_IDS.awaitingDispatch,
      name: names.awaiting_dispatch,
      query: 'health=awaiting_dispatch',
      sort: { key: 'dispatchBy', dir: 'asc' },
    },
    { id: ORDER_VIEW_IDS.sourceDeleted, name: names.source_deleted, query: 'health=source_deleted', tone: 'error' },
    { id: ORDER_VIEW_IDS.synced, name: names.synced, query: 'health=synced' },
  ];
}

export function createOrdersListRegistry(input: OrdersListConfigInput): ListRegistry<OrderRecord> {
  const { labels, cells } = input;
  return {
    pageKey: 'orders',
    locked: {
      id: 'order',
      label: labels.order,
      description: labels.orderFields,
      header: labels.order,
      render: cells.order,
      width: '20%',
      // #2538 - the identity cell stacks a thumbnail, the order number and a meta line.
      lines: 2,
    },
    columns: [
      {
        id: 'customer',
        label: labels.customer,
        defaultVisible: true,
        width: '13%',
        parts: [
          { id: 'name', label: labels.customerName, sort: 'customer', headerLabel: labels.customer, render: cells.customerName },
          { id: 'city', label: labels.customerCity, render: cells.customerCity },
          { id: 'note', label: labels.customerNote, render: cells.customerNote },
        ],
      },
      {
        id: 'channel',
        label: labels.channel,
        defaultVisible: true,
        width: '13%',
        // Folds under the order name below 1024px (#1713), which renders the chip inline instead.
        hideBelow: 1024,
        header: labels.channel,
        parts: [
          { id: 'source', label: labels.channelSource, render: cells.channelSource },
          { id: 'destination', label: labels.channelDestination, render: cells.channelDestination },
        ],
      },
      {
        id: 'status',
        label: labels.status,
        description: labels.statusFields,
        defaultVisible: true,
        width: '15%',
        header: labels.status,
        sortKey: 'status',
        render: cells.status,
      },
      {
        id: 'shipment',
        label: labels.shipment,
        defaultVisible: true,
        width: '17%',
        parts: [
          { id: 'state', label: labels.shipmentState, sort: 'fulfillment', headerLabel: labels.shipment, render: cells.shipmentState },
          { id: 'carrier', label: labels.shipmentCarrier, render: cells.shipmentCarrier },
        ],
        // Ship-by sorts a value the state field shows, so its button stays when the field is hidden.
        headerControls: [{ id: 'shipBy', label: labels.shipBy, sort: 'dispatchBy' }],
      },
      {
        id: 'money',
        label: labels.money,
        defaultVisible: true,
        width: '15%',
        align: 'right',
        // #2538/#2555 - Total, payment, the document line, the dates.
        lines: 5,
        parts: [
          { id: 'amount', label: labels.total, sort: 'total', headerLabel: labels.total, render: cells.moneyTotal },
          { id: 'payment', label: labels.payment, sort: 'payment', headerLabel: labels.payment, render: cells.moneyPayment },
          { id: 'document', label: labels.document, render: cells.moneyDocument },
          { id: 'placed', label: labels.placed, sort: 'placedAt', headerLabel: labels.placed, render: cells.moneyPlaced },
          { id: 'created', label: labels.created, sort: 'createdAt', headerLabel: labels.created, render: cells.moneyCreated },
        ],
      },
    ],
    filters: ORDER_VIEW_FILTERS,
    sorts: ORDER_SORT_KEYS.map((key) => ({
      key,
      dir: DEFAULT_ORDER_SORT_DIR[key],
      label: input.sortLabels[key],
    })),
    defaultSort: { key: DEFAULT_ORDER_SORT, dir: DEFAULT_ORDER_SORT_DIR[DEFAULT_ORDER_SORT] },
    systemViews: ordersSystemViews(input.viewNames),
    pinned: Object.values(ORDER_VIEW_IDS),
    lockedViewIds: [ORDER_VIEW_IDS.all, ORDER_VIEW_IDS.needsAttention],
    extraNonViewParams: ORDERS_NON_VIEW_PARAMS,
    sortCodec: ORDER_SORT_CODEC,
    storedQuery: ORDER_STORED_QUERY_CODEC,
  };
}
