/**
 * Offer Status Snapshot Upsert Failed Exception
 *
 * Thrown when the `offer_status_snapshots` upsert reports success but the row
 * cannot be read back on its `(connectionId, externalOfferId)` key (#2039) —
 * i.e. a concurrent delete removed it between the write and the read-back. The
 * repository converts that infrastructure-level surprise into a domain error
 * rather than returning a half-built result; the create/poll callers treat it
 * as a non-fatal write failure and let the hourly sync heal the row.
 *
 * @module libs/core/src/listings/domain/exceptions
 */
export class OfferStatusSnapshotUpsertFailedError extends Error {
  constructor(
    public readonly connectionId: string,
    public readonly externalOfferId: string
  ) {
    super(
      `Offer status snapshot upsert could not be read back: connectionId=${connectionId} externalOfferId=${externalOfferId}`
    );
    this.name = 'OfferStatusSnapshotUpsertFailedError';
    Error.captureStackTrace(this, this.constructor);
  }
}
