/**
 * Fiscal Registration Attempt Closed Exception (#3960)
 *
 * Raised by `register` when the job's key names an attempt the provider has
 * already REFUSED. Since #3960 a refusal is final under its key: the provider
 * keeps the refused document under it, so re-sending would only be answered
 * with that refusal, and could re-send an old attempt after a newer one already
 * registered the sale. Asking again starts a NEW attempt record under a new key
 * (`requestRegistration`), never re-runs this one.
 *
 * The case this exists for is a job enqueued under the attempt's key BEFORE
 * #3960 deployed (queued, or waiting out a retry backoff). Before #3960 such a
 * job re-claimed the refused row and re-sent it. It must now end as a clear,
 * terminal refusal - not a retry loop (nothing a retry does can change a
 * persisted refusal), and not a silent `ok` that reads as a job that did its
 * work. Nothing crosses the provider boundary on this path.
 *
 * The order is NOT stranded by it: the refused record still offers the Retry
 * action, and that request derives the next attempt's key from the refused
 * record itself, so the stale job neither blocks nor is joined by it.
 *
 * Country- and vendor-agnostic (ADR-042 decision 4).
 *
 * @module libs/core/src/fiscalization/domain/exceptions
 */
export class FiscalRegistrationAttemptClosedException extends Error {
  constructor(
    public readonly orderId: string,
    public readonly recordId: string,
  ) {
    super(
      `Fiscal registration ${recordId} for order ${orderId} was refused by the provider and is ` +
        `final under its key; nothing was sent. Ask again to start the next attempt`,
    );
    this.name = 'FiscalRegistrationAttemptClosedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
