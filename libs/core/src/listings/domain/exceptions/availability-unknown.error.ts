/**
 * Availability Unknown Error (#2323, ADR-061)
 *
 * Raised by a publish builder when `IAvailabilityService` answers
 * `provenance: 'unknown'` — OpenLinker asked what it may publish and could not
 * find out (the Control resolution or the reservation-ledger read failed).
 *
 * **This is RETRYABLE, and its class is what makes it so.** It deliberately does
 * NOT extend `OfferBuilderValidationException` /
 * `ProductPublishBuilderValidationException` /
 * `MasterCatalogConnectionNotConfiguredException`: each execution service's
 * `mapBuilderException` recognises those and terminalises the child as a
 * `business_failure` (ADR-007), which is precisely wrong here — nothing about
 * the operator's request is invalid, an infrastructure read was unavailable, and
 * the same publish will succeed on the next attempt. An unrecognised error is
 * rethrown, so the job retries and nothing is written. A plain `Error` subclass
 * is therefore the contract, not an oversight.
 *
 * It is also raised BEFORE the command is assembled, so no partially-built
 * command carrying an unbuffered quantity can escape: publishing the raw
 * intended quantity would drive straight through the operator's configured
 * oversell cushion, which is the failure the buffer exists to prevent.
 *
 * @module libs/core/src/listings/domain/exceptions
 * @see docs/architecture/adrs/061-advisory-reservations-and-availability-authority.md
 */
export class AvailabilityUnknownError extends Error {
  constructor(
    public readonly connectionId: string,
    public readonly internalVariantId: string
  ) {
    super(
      `Availability is unknown for variant '${internalVariantId}' on connection ` +
        `'${connectionId}' — the publish was suppressed rather than sent without the ` +
        `destination's configured stock controls. This is a transient read failure; retry.`
    );
    this.name = 'AvailabilityUnknownError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AvailabilityUnknownError);
    }
  }
}
