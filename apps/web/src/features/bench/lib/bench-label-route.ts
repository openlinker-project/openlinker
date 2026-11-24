/**
 * Which label case a box is in, from its route (#3958)
 *
 * A box with no label used to render nothing, and a box with a failed shipment
 * always read "the carrier would not give us a label". Both were wrong whenever
 * the delivery method is not routed to a carrier at all: the shop ships those,
 * or nobody has chosen who does, and no carrier was ever asked.
 *
 * This decides, from the route the parcel read carries, which of those a box
 * is in. Pure, so the card's four cases are tested without rendering it.
 *
 * @module apps/web/src/features/bench/lib
 */
import type { BenchParcelRoute } from '../api/bench-parcel.types';

/**
 * The kinds that buy a label through OpenLinker. Mirrors the backend's reading
 * in the auto-dispatch job: only these two reach a carrier, and `omp_fulfilled`
 * is the shop or marketplace shipping it itself.
 */
const LABEL_BUYING_KINDS: readonly string[] = ['ol_managed_carrier', 'source_brokered'];

export type BenchLabelRouteCase =
  /** OpenLinker buys this box's label through a carrier that is switched on. */
  | {
      readonly kind: 'buys-label';
      readonly carrierName: string | null;
      readonly methodLabel: string | null;
    }
  /** The route buys a label, but through a carrier connection that is switched off. */
  | {
      readonly kind: 'carrier-off';
      readonly carrierName: string | null;
      readonly methodLabel: string | null;
    }
  /** An operator chose to have the shop (or marketplace) ship this method. */
  | {
      readonly kind: 'shop-ships';
      readonly shopName: string | null;
      readonly methodLabel: string | null;
    }
  /** No rule exists for this method, so nobody has decided who ships it. */
  | { readonly kind: 'no-carrier'; readonly methodLabel: string | null }
  /**
   * The route is not known: the API could not resolve it, or sent a kind this
   * build does not recognise. The card then says only what the shipment says,
   * rather than guessing a route.
   */
  | { readonly kind: 'unknown' };

export function describeBenchLabelRoute(route: BenchParcelRoute | null): BenchLabelRouteCase {
  if (route === null) return { kind: 'unknown' };

  if (LABEL_BUYING_KINDS.includes(route.processorKind)) {
    return route.processorAvailable
      ? { kind: 'buys-label', carrierName: route.processorName, methodLabel: route.methodLabel }
      : { kind: 'carrier-off', carrierName: route.processorName, methodLabel: route.methodLabel };
  }

  if (route.processorKind === 'omp_fulfilled') {
    // `fromRule` and never the kind alone: a rule routing to the shop is an
    // operator's choice, while the same kind on the default route is the
    // absence of one. Saying "nobody has chosen" about the first would be false.
    return route.fromRule
      ? { kind: 'shop-ships', shopName: route.processorName, methodLabel: route.methodLabel }
      : { kind: 'no-carrier', methodLabel: route.methodLabel };
  }

  return { kind: 'unknown' };
}

/**
 * Whether a missing or failed label is the CARRIER's to explain.
 *
 * Only on a route that buys a label: a box the shop ships was never sent to a
 * carrier, so "the carrier would not give us a label" there blames somebody
 * who was not asked. An unknown route keeps the old reading, because without
 * the route the shipment's failure is the only fact there is.
 */
export function isCarrierAccountable(routeCase: BenchLabelRouteCase): boolean {
  return routeCase.kind === 'buys-label' || routeCase.kind === 'unknown';
}

/**
 * The carrier name a ready label may be titled with: the routed connection's
 * operator-given name, and only on a route that buys a label.
 */
export function labelCarrierName(routeCase: BenchLabelRouteCase): string | null {
  return routeCase.kind === 'buys-label' || routeCase.kind === 'carrier-off'
    ? routeCase.carrierName
    : null;
}
