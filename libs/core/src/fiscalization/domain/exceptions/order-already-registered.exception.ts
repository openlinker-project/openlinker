/**
 * Order Already Registered Exception (#1908)
 *
 * Raised when an order that already carries a BLOCKING `FiscalRegistrationRecord`
 * is asked to start a SECOND originating registration of the same sale - under a
 * different exactly-once key, or on a different fiscalization connection.
 *
 * This is the guard the `(connectionId, idempotencyKey)` unique index cannot be:
 * the index does not know what an order is, so a second key registers the same
 * sale twice while every per-key invariant still holds. ADR-042 decision 6 places
 * the exactly-once guarantee in the contract precisely because a double
 * registration is a LEGAL EVENT for the seller, so the second attempt is refused
 * rather than deduplicated after the fact.
 *
 * "Blocking" is `FiscalRegistrationRecord.blocksFurtherRegistration` - `pending`,
 * `registering`, `registered`, or `failed` with any `failureMode` other than
 * `rejected`. Only a terminal `rejected` failure (the provider definitely created
 * nothing) leaves the sale free to be registered again. The predicate mirrors
 * ADR-041 §3b's originating-document rule so the two document contexts cannot
 * disagree about what "already documented" means.
 *
 * Country- and vendor-agnostic (ADR-042 decision 4): the message names ids and a
 * neutral status only. Mapped to HTTP 409 at the controller boundary.
 *
 * @module libs/core/src/fiscalization/domain/exceptions
 */
import type { FiscalRegistrationStatus } from '../types/fiscalization.types';

export class OrderAlreadyRegisteredException extends Error {
  constructor(
    public readonly orderId: string,
    /** The connection that already holds the blocking record. */
    public readonly registeringConnectionId: string,
    /** The connection the refused request targeted. */
    public readonly requestedConnectionId: string,
    /** Neutral status of the blocking record. */
    public readonly blockingStatus: FiscalRegistrationStatus,
    /** The blocking record's id, so an operator can open it directly. */
    public readonly blockingRecordId: string,
  ) {
    super(
      `Order ${orderId} already has a fiscal registration on connection ` +
        `${registeringConnectionId} (record ${blockingRecordId}, status ${blockingStatus}); ` +
        `it cannot be registered again on connection ${requestedConnectionId}`,
    );
    this.name = 'OrderAlreadyRegisteredException';
    Error.captureStackTrace(this, this.constructor);
  }
}
