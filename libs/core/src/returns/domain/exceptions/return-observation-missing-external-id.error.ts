/**
 * Return Observation Missing External Id Error
 *
 * Thrown when an ingested `IncomingReturn` carries no usable `externalReturnId`
 * (absent, empty or whitespace-only), so core cannot key the idempotent
 * update-or-create.
 *
 * This is a non-retryable error until the adapter supplies a key: the unique
 * index is partial (`WHERE "externalReturnId" IS NOT NULL`), so a NULL-keyed
 * ingestion has no conflict target and would duplicate the return on every
 * re-sync rather than converge. Synthesising the key is the ADAPTER's job —
 * only it knows which of the source's coordinates are stable across re-syncs.
 * A caller skips the ITEM and continues the page; the page is not at fault.
 *
 * @module libs/core/src/returns/domain/exceptions
 */
export class ReturnObservationMissingExternalIdError extends Error {
  constructor(
    public readonly sourceConnectionId: string,
    public readonly externalOrderId: string | null
  ) {
    super(
      `Return observation carries no externalReturnId (sourceConnectionId=${sourceConnectionId}, externalOrderId=${externalOrderId ?? 'null'}) — the adapter must synthesise a deterministic, source-stable key`
    );
    this.name = 'ReturnObservationMissingExternalIdError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ReturnObservationMissingExternalIdError);
    }
  }
}
