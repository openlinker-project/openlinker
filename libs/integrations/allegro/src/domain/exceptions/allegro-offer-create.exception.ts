/**
 * Allegro Offer Create Exception
 *
 * Raised by `AllegroMarketplaceAdapter.createOffer` when Allegro rejects the
 * creation with a non-2xx response — no offer was created, there is no
 * marketplace-side id. Carries structured Allegro validation errors so
 * callers (worker handlers) can persist them on the `OfferCreationRecord`.
 *
 * 2xx responses with inline validation errors do NOT throw this — the offer
 * exists as a draft and the errors flow through `CreateOfferResult.validationErrors`.
 *
 * @module libs/integrations/allegro/src/domain/exceptions
 */

import type { AllegroValidationError } from '../types/allegro-api.types';

export class AllegroOfferCreateException extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errors: AllegroValidationError[],
  ) {
    super(
      `Allegro rejected offer creation (HTTP ${statusCode}, ${errors.length} error${
        errors.length === 1 ? '' : 's'
      })`,
    );
    this.name = 'AllegroOfferCreateException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AllegroOfferCreateException);
    }
  }
}
