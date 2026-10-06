/**
 * Orders list — filter bar copy (#3507, mockup m4b-orders-filters)
 *
 * The lifecycle-phase axis is worded "Stage": `phase` is model vocabulary the
 * UI must not render (P9, `check-ui-vocabulary`).
 *
 * Every operator-facing string of the orders list's search + filter surface:
 * the search box, the Filters panel groups, the quick-filter row, the active
 * filter chips and the mobile sheet. Kept apart from the page so the page
 * stays layout and the strings stay reviewable in one place.
 *
 * @module apps/web/src/features/orders/lib
 */
import type {
  FulfillmentRollupStateValue,
  OrderHealthValue,
  SlaStateValue,
} from '../api/orders.types';

export const ORDERS_LIST_FILTERS_COPY = {
  searchLabel: 'Search orders',
  /** M4 pin 1: the full promise, only when the install stores buyer data. */
  searchPlaceholderWithPii: 'Search by order number, buyer, email, SKU or tracking number…',
  /** G03-14: with personal data storage off, buyer and email are not indexed. */
  searchPlaceholderNoPii: 'Search by order number, SKU or tracking number…',
  searchShortcut: '/',
  toggleShortcut: 'F',
  toggleTitle: 'Show or hide filters (F)',
  results: (formatted: string): string => (formatted === '1' ? '1 result' : `${formatted} results`),

  groupSource: 'Source & dates',
  groupShipment: 'Shipment',
  groupExceptions: 'Exceptions',
  groupTags: 'Tags',
  groupPhase: 'Stage',
  groupStatus: 'Status',

  fieldSource: 'Source',
  allSources: 'All sources',
  fieldCreated: 'Created',
  createdFrom: 'From',
  createdTo: 'To',
  createdFromAria: 'Created from',
  createdToAria: 'Created to',
  fieldFulfillment: 'Fulfillment',
  anyFulfillment: 'Any fulfillment',
  fieldShipBy: 'Ship-by',
  anySla: 'Any',
  fieldPacking: 'Packing',
  anyPacking: 'Any packing',
  packedYes: 'Packed',
  packedNo: 'Not packed yet',
  fieldHold: 'Hold reason',
  anyHold: 'Any hold reason',
  checkSalesDocsBlocked: 'Sales documents blocked',
  checkOmsStopped: 'OpenLinker stopped',
  checkRateConflict: 'Rate conflict',
  checkOpenReturn: 'Open return',
  checkBreaching: 'Ship-by ≤ 24h or overdue',
  tagGroupAria: 'Tag',
  anyTag: 'Any tag',
  noTags: 'No tags',
  noTagsYet: 'No tags yet.',
  findTag: 'Find a tag',
  anyPhase: 'Any stage',
  anyStatus: 'All orders',

  quickFiltersAria: 'Quick filters',
  quickNeedsLook: 'Needs a look',
  quickPhase: 'Stage',
  quickBreaching: 'Ship-by ≤ 24h',
  quickSalesDocs: 'Sales docs blocked',
  quickSalesDocsTitle: (issuedOnRequest: number): string =>
    `${issuedOnRequest} more are issued on request — waiting for you by configuration, not blocked.`,
  quickRateConflict: 'Rate conflict',
  quickOmsStopped: 'OpenLinker stopped',
  quickOpenReturn: 'Open return',
  overdue: (n: number): string => `${n} overdue`,
  atRisk: (n: number): string => `${n} at risk`,
  reviewDispatchRisk: 'Review dispatch risk',
  dispatchRiskOverview: 'Dispatch risk',

  panelHint: 'Filters apply as you change them and stay in the address bar.',
  clearAll: 'Clear all',
  hideFilters: 'Hide filters',
  sheetTitle: 'Filters',
  showOrders: (formatted: string | null): string =>
    formatted === null
      ? 'Show orders'
      : formatted === '1'
        ? 'Show 1 order'
        : `Show ${formatted} orders`,
  sectionNone: 'None',
  sectionAny: 'Any',

  chipHealth: 'Status',
  chipSource: 'Source',
  chipUnknownSource: 'Unknown source',
  chipCreated: 'Created',
  chipCreatedFrom: (d: string): string => `from ${d}`,
  chipCreatedTo: (d: string): string => `until ${d}`,
  chipDue: 'Due',
  chipDueValue: '≤ 24h or overdue',
  chipShipBy: 'Ship-by',
  chipFulfillment: 'Fulfillment',
  chipSalesDocs: 'Sales documents',
  chipBlocked: 'Blocked',
  chipPhase: 'Stage',
  chipTaxRate: 'Tax rate',
  chipConflict: 'Conflict',
  chipHold: 'Hold',
  chipOms: 'OpenLinker',
  chipStopped: 'Stopped',
  chipPacking: 'Packing',
  chipSearch: 'Search',
  chipSearchValue: (q: string): string => `“${q}”`,
  chipReturn: 'Return',
  chipOpen: 'Open',
  chipTag: 'Tag',
  chipUnknownTag: 'Unknown tag',

  noResultsTitle: (q: string): string => `No orders match “${q}”`,
  noResultsMessage:
    'We searched order numbers, buyer names and emails, SKUs and tracking numbers. A tracking number is only searchable once a label exists.',
  noResultsMessageNoPii:
    'We searched order numbers, SKUs and tracking numbers. A tracking number is only searchable once a label exists.',
  clearSearch: 'Clear search',
  noFilterResultsTitle: 'No orders in this view',
  noFilterResultsMessage: (summary: string): string =>
    summary ? `No orders match ${summary}. Clear the filters to see everything.` : 'No orders match the current filters. Clear them to see everything.',
  clearFilters: 'Clear filters',
} as const;

/** Health partition labels — the KPI cards and the `health` chip read the same words. */
export const ORDER_HEALTH_LABELS: Record<OrderHealthValue, string> = {
  source_deleted: 'Source deleted',
  needs_attention: 'Needs attention',
  awaiting_mapping: 'Awaiting mapping',
  awaiting_dispatch: 'Awaiting dispatch',
  synced: 'Synced',
};

/** Ship-by SLA buckets offered as a filter — `none` is not a triage state (#1108). */
export const SLA_FILTER_OPTIONS: readonly { value: SlaStateValue; label: string }[] = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'at_risk', label: 'At risk' },
  { value: 'on_track', label: 'On track' },
];

/** Fulfillment rollup options (#1108). */
export const FULFILLMENT_FILTER_OPTIONS: readonly {
  value: FulfillmentRollupStateValue;
  label: string;
}[] = [
  { value: 'not-shipped', label: 'Not shipped' },
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'failed', label: 'Dispatch failed' },
];
