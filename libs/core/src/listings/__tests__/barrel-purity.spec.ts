/**
 * Listings Barrel Purity — regression guard
 *
 * Pins the #359 architectural invariant: the main `@openlinker/core/listings`
 * barrel MUST NOT re-export `ListingsModule` or any of the 8 `@Injectable`
 * service classes. (Service count grew from 7 → 8 in #718 with the addition of
 * `OfferMappingsService`; same architectural rule still applies.) Those live on the companion subpath
 * `@openlinker/core/listings/services` so sibling packages (e.g.
 * `@openlinker/core/products`) can value-import from the main barrel without
 * triggering the runtime circular require that #337 originally hit.
 *
 * If this spec fails, a future PR has silently added a poison export to
 * `libs/core/src/listings/index.ts`. Move the export to the `services`
 * subpath instead.
 *
 * @module libs/core/src/listings/__tests__
 */

import * as listings from '@openlinker/core/listings';

const FORBIDDEN_EXPORTS = [
  'ListingsModule',
  'OfferLinkingService',
  'OfferMappingSyncService',
  'OfferMappingsService',
  'CategoryResolutionService',
  'OfferBuilderService',
  'OfferCreationExecutionService',
  'SellerPoliciesService',
  'OfferCreationEnqueueService',
  'ProductPublishBuilderService',
  'ProductPublishExecutionService',
] as const;

describe('@openlinker/core/listings barrel purity (#359)', () => {
  it.each(FORBIDDEN_EXPORTS)(
    'does not re-export %s (move to @openlinker/core/listings/services)',
    (name) => {
      expect(listings).not.toHaveProperty(name);
    },
  );
});
