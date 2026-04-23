/**
 * Offer Manager Port
 *
 * Canonical capability contract for marketplace offer / listing management.
 * The base port carries only the one method every marketplace adapter must
 * implement: `updateOfferQuantity`. All other previously-optional methods
 * (feed, events, field updates, offer creation, category directory, policies)
 * now live as distinct capability interfaces under `./capabilities/`.
 *
 * Adapters declare the extra capabilities they support via `implements`
 * (e.g. `implements OfferManagerPort, OfferLister, OfferCreator, …`).
 * Call sites narrow support via the co-located type guards
 * (`isOfferLister`, `isOfferCreator`, …) instead of presence checks on
 * optional methods.
 *
 * Split out of the legacy `MarketplacePort` (#328); optional methods split
 * out into capability interfaces (#337).
 *
 * Domain-only: no framework dependencies, no import from `@openlinker/core/orders`.
 *
 * @module libs/core/src/listings/domain/ports
 */

import type { UpdateOfferQuantityCommand } from '../types/offer-quantity-update.types';

export interface OfferManagerPort {
  /**
   * Update a single offer quantity.
   */
  updateOfferQuantity(cmd: UpdateOfferQuantityCommand): Promise<void>;
}
