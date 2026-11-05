/**
 * Shipping route copy (#3958)
 *
 * One plain-language answer to "who ships this delivery method?", for every
 * surface that shows a fulfilment route: the routing panel, the OMS setup's
 * Shipping step, order detail, the pack bench and the connection pages. The
 * three processor kinds are backend vocabulary; an operator recognises "your
 * shop ships it" and "OpenLinker buys the InPost label", so those are the only
 * words any surface uses.
 *
 * @module apps/web/src/features/mappings/lib
 */
import type { FulfillmentProcessorKind } from '../api/mappings.types';

export const SHIPPING_ROUTE_COPY = {
  panelTitle: 'Who ships each delivery method',
  intro: (sourceLabel: string, shopName: string | null): string =>
    `Pick who ships each ${sourceLabel} delivery method. Anything you leave unchanged is shipped by ${shopName ?? 'your shop'}, the way it is today.`,
  noCarrier:
    'No carrier is connected yet, so every delivery method is shipped by your shop. Connect InPost or DPD to let OpenLinker buy the labels.',
  methodColumn: (sourceLabel: string): string => `${sourceLabel} delivery method`,
  routeColumn: 'Who ships it',
  defaultOption: (shopName: string | null): string =>
    shopName ? `${shopName} ships it (default)` : 'Your shop ships it (default)',
  unavailable: (label: string): string => `${label} (connection is off)`,
  sourceShipping: (sourceLabel: string): string => `${sourceLabel} shipping`,
  dialogTitle: (sourceName: string): string => `Who ships ${sourceName} orders`,
  dialogDescription: (sourceName: string, methodLabel: string | null): string =>
    `${methodLabel ? `This order uses ${methodLabel}. ` : ''}A change here applies to every ${sourceName} order from now on.`,
  dialogDone: 'Done',
  discardTitle: 'Close without saving?',
  discardDescription: 'You changed who ships some delivery methods and did not click Save routing.',
  discardConfirm: 'Close without saving',
  discardCancel: 'Keep editing',
} as const;

/** The route as an operator reads it, e.g. "OpenLinker buys the label from InPost". */
export function describeShippingRoute(kind: FulfillmentProcessorKind, connectionName: string): string {
  switch (kind) {
    case 'omp_fulfilled':
      return `${connectionName} ships it`;
    case 'ol_managed_carrier':
      return `OpenLinker buys the label from ${connectionName}`;
    case 'source_brokered':
      return `OpenLinker buys the label through ${connectionName} shipping`;
  }
}

/** Whether a route makes OpenLinker buy a label (and therefore can be automatic). */
export function routeBuysLabel(kind: FulfillmentProcessorKind | null): boolean {
  return kind === 'ol_managed_carrier' || kind === 'source_brokered';
}
