/**
 * Location Owner Connection Not Found Error
 *
 * Raised when a location write names an `ownerConnectionId` that is
 * syntactically a uuid but references no `connections` row, so Postgres
 * refuses the write with a foreign-key violation (SQLSTATE 23503).
 *
 * This is deliberately a DIFFERENT failure from a malformed id: the DTO's
 * `@IsUUID()` rejects the wrong SHAPE at the boundary (400), while a
 * well-formed id naming nothing is a statement about the operator's current
 * data — the request would be accepted against a state where that connection
 * exists. The interface layer maps it to 422 Unprocessable Entity for exactly
 * that reason; without the translation the driver error surfaces as a 500 on
 * well-formed admin input.
 *
 * The message names the connection id so an operator can act on it without
 * reading a log.
 *
 * @module libs/core/src/inventory/domain/exceptions
 */
export class LocationOwnerConnectionNotFoundError extends Error {
  constructor(public readonly ownerConnectionId: string) {
    super(
      `Inventory location owner connection ${ownerConnectionId} does not exist`
    );
    this.name = 'LocationOwnerConnectionNotFoundError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, LocationOwnerConnectionNotFoundError);
    }
  }
}
