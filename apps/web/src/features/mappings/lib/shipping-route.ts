/**
 * Shipping route wording (#3958)
 *
 * One plain-language answer to "who ships this delivery method?", for every
 * surface that shows a fulfilment route: the routing panel, the OMS setup's
 * Shipping step, order detail, the pack bench and the connection pages. The
 * three processor kinds are backend vocabulary; an operator recognises "your
 * shop ships it" and "OpenLinker buys the InPost label", so those are the only
 * words any surface uses.
 *
 * The sentences live in the `mappings` namespace of the locale files
 * (ADR-081). This module only picks the sentence a case needs, so a missing
 * shop name gets its own sentence in every language instead of an English
 * phrase spliced into a translated one.
 *
 * @module apps/web/src/features/mappings/lib
 */
import { interpolate, messagesIn, type Messages, type ResolvedCopy, type SupportedLocale } from '../../../shared/i18n';
import type { FulfillmentProcessorKind } from '../api/mappings.types';

export type ShippingRouteMessages = ResolvedCopy<Messages['mappings']>['shippingRoute'];

export interface ShippingRouteCopy {
  readonly panelTitle: string;
  readonly intro: (sourceLabel: string, shopName: string | null) => string;
  readonly noCarrier: string;
  readonly methodColumn: (sourceLabel: string) => string;
  readonly routeColumn: string;
  readonly defaultOption: (shopName: string | null) => string;
  readonly unavailable: (label: string) => string;
  /** The default option's short name inside the "Your shop ships it" group. */
  readonly defaultShort: (shopName: string | null) => string;
  readonly groupLabel: { readonly shop: string; readonly label: string };
  readonly thisOrder: string;
  readonly sourceShipping: (sourceLabel: string) => string;
  readonly dialogTitle: (sourceName: string) => string;
  readonly dialogDescription: (sourceName: string, methodLabel: string | null, methodId?: string | null) => string;
  readonly dialogDone: string;
  readonly discardTitle: string;
  readonly discardDescription: string;
  readonly discardConfirm: string;
  readonly discardCancel: string;
  /** The route as an operator reads it, e.g. "OpenLinker buys the label from InPost". */
  readonly describe: (kind: FulfillmentProcessorKind, connectionName: string) => string;
}

export function buildShippingRouteCopy(m: ShippingRouteMessages): ShippingRouteCopy {
  return {
    panelTitle: m.panelTitle,
    intro: (sourceLabel, shopName) =>
      shopName === null
        ? interpolate(m.introNoShop, { source: sourceLabel })
        : interpolate(m.intro, { source: sourceLabel, shop: shopName }),
    noCarrier: m.noCarrier,
    methodColumn: (sourceLabel) => interpolate(m.methodColumn, { source: sourceLabel }),
    routeColumn: m.routeColumn,
    defaultOption: (shopName) =>
      shopName ? interpolate(m.defaultOption, { shop: shopName }) : m.defaultOptionNoShop,
    unavailable: (label) => interpolate(m.unavailable, { label }),
    defaultShort: (shopName) =>
      shopName === null ? m.defaultShortNoShop : interpolate(m.defaultShort, { shop: shopName }),
    groupLabel: m.groupLabel,
    thisOrder: m.thisOrder,
    sourceShipping: (sourceLabel) => interpolate(m.sourceShipping, { source: sourceLabel }),
    dialogTitle: (sourceName) => interpolate(m.dialogTitle, { source: sourceName }),
    // The order's method is marked "This order" and listed first in the table,
    // so the sentence only has to say what a change reaches.
    dialogDescription: (sourceName, methodLabel, methodId = null) =>
      methodLabel || methodId
        ? interpolate(m.dialogDescriptionWithMethod, { source: sourceName })
        : interpolate(m.dialogDescription, { source: sourceName }),
    dialogDone: m.dialogDone,
    discardTitle: m.discardTitle,
    discardDescription: m.discardDescription,
    discardConfirm: m.discardConfirm,
    discardCancel: m.discardCancel,
    describe: (kind, connectionName) => {
      switch (kind) {
        case 'omp_fulfilled':
          return interpolate(m.route.ompFulfilled, { name: connectionName });
        case 'ol_managed_carrier':
          return interpolate(m.route.olManagedCarrier, { name: connectionName });
        case 'source_brokered':
          return interpolate(m.route.sourceBrokered, { name: connectionName });
      }
    },
  };
}

/** The same wording for an explicit language, outside React (tests, formatters). */
export function shippingRouteCopyIn(locale: SupportedLocale): ShippingRouteCopy {
  return buildShippingRouteCopy(messagesIn('mappings', locale).shippingRoute);
}

/** Whether a route makes OpenLinker buy a label (and therefore can be automatic). */
export function routeBuysLabel(kind: FulfillmentProcessorKind | null): boolean {
  return kind === 'ol_managed_carrier' || kind === 'source_brokered';
}
