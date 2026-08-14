/**
 * Taxonomy Identity Provider Capability
 *
 * Optional sub-capability of `OfferManagerPort`. An adapter that *owns* a
 * marketplace taxonomy declares WHICH distinct tree the connection reads and
 * writes (ADR-037's "one value per distinct tree" rule) rather than letting core
 * infer it from `platformType` — an inference that cannot express an axis the
 * platform splits its tree along. Allegro is the motivating case: `environment`
 * selects a different API host, so a sandbox and a production connection publish
 * genuinely different trees while sharing one `platformType` (#2063).
 *
 * Deliberately NOT `TaxonomyBorrower` (#1045). The two answer different
 * questions — a borrower says "whose *mappings* do I reuse?", read by
 * `OfferBuilderService`; this says "which *tree* do I read and write?", read by
 * `resolveTaxonomyOwner`. Making an owner implement `TaxonomyBorrower` would
 * silently reroute every Allegro offer build onto the borrower branch of
 * mapping resolution.
 *
 * Advertised-without-dispatch: resolved only by narrowing an already-dispatched
 * `OfferManager` adapter with the guard below, never via `getCapabilityAdapter`.
 * Follows `TaxonomyBorrower`'s precedent; no `CoreCapabilityValues` entry.
 *
 * See `offer-lister.capability.ts` for the shared naming convention.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { TaxonomyOwner } from '../../types/taxonomy-owner.types';
import type { OfferManagerPort } from '../offer-manager.port';

export interface TaxonomyIdentityProvider {
  /** The distinct tree this connection reads and writes (ADR-037). */
  getTaxonomyIdentity(): TaxonomyOwner;
}

export function isTaxonomyIdentityProvider(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & TaxonomyIdentityProvider {
  return typeof (adapter as Partial<TaxonomyIdentityProvider>).getTaxonomyIdentity === 'function';
}
