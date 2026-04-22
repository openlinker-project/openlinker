/**
 * Offer Create Rejected Exception
 *
 * Neutral domain exception thrown by any marketplace adapter implementing
 * `OfferManagerPort.createOffer` when the platform rejects the create request
 * and no offer was created (e.g. Allegro 4xx response). Carries the platform's
 * validation errors mapped into the neutral `CreateOfferValidationError` shape
 * so core services can persist them to an `OfferCreationRecord` without
 * depending on any specific integration package.
 *
 * 2xx responses with inline validation errors do NOT throw this — the offer
 * exists as a draft and the errors flow through `CreateOfferResult.validationErrors`.
 *
 * @module libs/core/src/listings/domain/exceptions
 */

import type { CreateOfferValidationError } from '../types/offer-create.types';

export class OfferCreateRejectedException extends Error {
  constructor(
    /** Adapter key of the platform that rejected the create (e.g. 'allegro.publicapi.v1'). */
    public readonly adapterKey: string,
    /** Optional HTTP status code when the rejection came from an API call. `0` for preflight validation. */
    public readonly statusCode: number,
    /** Neutral validation errors describing why the platform rejected the create. */
    public readonly errors: CreateOfferValidationError[],
  ) {
    super(
      `Marketplace ${adapterKey} rejected offer creation (status=${statusCode}, ${errors.length} error${
        errors.length === 1 ? '' : 's'
      })`,
    );
    this.name = 'OfferCreateRejectedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
