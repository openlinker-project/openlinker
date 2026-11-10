/**
 * Bundle availability line (#3624): how many bundles the stock of the
 * components allows, and which component is the limit. A component whose stock
 * is unknown makes the whole answer unknown: an unknown count is never read as
 * zero, so a set is never advertised as sold out (or in stock) on a guess.
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
