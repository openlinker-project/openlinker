/**
 * Order detail tabs (#4286)
 *
 * The tab ids, the legacy deep-link anchors each tab owns, and the one
 * resolver that turns the URL into an active tab. The selected tab lives in the
 * `?tab=` search param (URL state, per docs/frontend-architecture.md), and the
 * anchors the orders list and the shipments list already link to
 * (`#shipment`, `#invoicing`, `#packing`, `#order-raw-snapshot`) keep working by
 * mapping onto the tab that holds them.
 *
 * @module apps/web/src/features/orders/lib
 */

export const ORDER_DETAIL_TAB_IDS = [
  'overview',
  'shipping',
  'packing',
  'documents',
  'returns',
  'notes',
  'history',
  'technical',
] as const;

export type OrderDetailTabId = (typeof ORDER_DETAIL_TAB_IDS)[number];

export const DEFAULT_ORDER_DETAIL_TAB: OrderDetailTabId = 'overview';

/** Anchor element id -> the tab whose panel contains it. */
const ANCHOR_TAB: Readonly<Record<string, OrderDetailTabId>> = {
  shipment: 'shipping',
  packing: 'packing',
  hold: 'packing',
  invoicing: 'documents',
  'order-raw-snapshot': 'technical',
};

export function isOrderDetailTabId(value: string | null | undefined): value is OrderDetailTabId {
  return value != null && (ORDER_DETAIL_TAB_IDS as readonly string[]).includes(value);
}

export function tabForAnchor(anchorId: string): OrderDetailTabId | null {
  return ANCHOR_TAB[anchorId] ?? null;
}

/**
 * `?tab=` wins; otherwise a legacy anchor decides; otherwise the default. A
 * `retryShipmentId` deep link lands on Shipping, where the panel that consumes it lives.
 */
export function resolveOrderDetailTab(input: {
  tabParam: string | null;
  hash: string;
  hasRetryShipmentId: boolean;
}): OrderDetailTabId {
  if (isOrderDetailTabId(input.tabParam)) return input.tabParam;
  const anchorTab = tabForAnchor(input.hash.replace(/^#/, ''));
  if (anchorTab) return anchorTab;
  if (input.hasRetryShipmentId) return 'shipping';
  return DEFAULT_ORDER_DETAIL_TAB;
}
