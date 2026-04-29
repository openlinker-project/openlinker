/**
 * Missing Source External Id Exception
 *
 * Defensive guard thrown when an OrderRecord exists but no identifier mapping
 * for its source connection is found. Indicates internal data inconsistency —
 * this should never happen for an OrderRecord persisted through the normal
 * ingestion path, since `OrderIngestionService.syncOrderFromSource` creates
 * the mapping before persisting the record. Surfaces as 5xx in the API layer.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class MissingSourceExternalIdException extends Error {
  constructor(
    public readonly internalOrderId: string,
    public readonly sourceConnectionId: string,
  ) {
    super(
      `Order ${internalOrderId} has no source external id mapping for connection ${sourceConnectionId}`,
    );
    this.name = 'MissingSourceExternalIdException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MissingSourceExternalIdException);
    }
  }
}
