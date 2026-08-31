/**
 * Return Source Not Readable Error (#2400)
 *
 * The connection cannot read returns from its source, so there is nothing to
 * hydrate. Raised by `ReturnIngestionService.syncReturnFromSource` in place of
 * the bare `Error` it used to throw.
 *
 * ## Why this needed a named class
 *
 * `marketplace.return.sync` is gated on `OrderSource` — correctly, because
 * `ReturnSourceReader` is a guard-only sub-capability that
 * `connection.enabledCapabilities` can never contain (#2085). The cost of that
 * correct gate is that it is over-permissive in the other direction: a plain
 * `OrderSource` connection with no return reader (PrestaShop, WooCommerce)
 * passes it and enqueues a job that then fails at the narrow. #2400 made that
 * reachable from a second direction by adding the `'return'` inbound domain, so
 * a webhook can now produce it too.
 *
 * A bare `Error` was rewrapped by the handler into a retryable
 * `SyncJobExecutionError`, spending the full ten-attempt ladder plus one dead
 * row on a **structural** condition no retry can change. This class lets the
 * handler answer a terminal `business_failure` instead (ADR-007) — the same
 * treatment `ReturnObservationMissingExternalIdError` already gets beside it,
 * and for the same reason.
 *
 * Non-retryable. Fixing it is an operator action (enable a connection whose
 * adapter reads returns) or an impossibility (the source publishes no return
 * read at all).
 *
 * @module libs/core/src/returns/domain/exceptions
 */

export class ReturnSourceNotReadableError extends Error {
  constructor(
    public readonly connectionId: string,
    public readonly externalReturnId: string
  ) {
    super(
      `Connection ${connectionId} does not support reading returns from its source ` +
        `(external return ${externalReturnId})`
    );
    this.name = 'ReturnSourceNotReadableError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ReturnSourceNotReadableError);
    }
  }
}
