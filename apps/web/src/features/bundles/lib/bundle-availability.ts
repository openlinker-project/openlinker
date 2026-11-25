/**
 * Bundle availability line (#3624): how many bundles the stock of the
 * components allows, and which component is the limit. A component whose stock
 * is unknown makes the whole answer unknown: an unknown count is never read as
 * zero, so a set is never advertised as sold out (or in stock) on a guess.
 *
 * Scope: the input is GLOBAL available-to-promise, with no channel reserve and no pending
 * orders. The listing wizard Review reads the same rule over CHANNEL scope (after the reserve,
 * see bundle-offer-preview.service.ts), so the two numbers can differ by design; the bundle
 * view shows both. The shared fixture in bundle-availability.test.ts pins the rule itself
 * (min of floor(stock / quantity)) for both: change one side and that table must follow.
 *
 * @module apps/web/src/features/bundles/lib
 */

export interface AvailabilityComponent {
  name: string;
  quantity: number;
  /** Units OpenLinker would promise; `null` = unknown. */
  availableToPromise: number | null;
}

export type BundleAvailability =
  | { kind: 'known'; bundles: number; limitedBy: string | null }
  | { kind: 'unknown'; component: string | null }
  | { kind: 'empty' };

export function computeBundleAvailability(
  components: readonly AvailabilityComponent[],
): BundleAvailability {
  if (components.length === 0) {
    return { kind: 'empty' };
  }
  const unknown = components.find((c) => c.availableToPromise === null);
  if (unknown) {
    return { kind: 'unknown', component: unknown.name };
  }
  let best: { bundles: number; name: string } | null = null;
  for (const component of components) {
    const supported = Math.floor((component.availableToPromise ?? 0) / component.quantity);
    if (best === null || supported < best.bundles) {
      best = { bundles: supported, name: component.name };
    }
  }
  if (best === null) {
    return { kind: 'empty' };
  }
  // A single component that is the whole bundle is not worth naming as a "limit".
  return { kind: 'known', bundles: best.bundles, limitedBy: components.length > 1 ? best.name : null };
}
