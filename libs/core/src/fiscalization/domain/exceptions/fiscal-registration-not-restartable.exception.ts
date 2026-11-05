/**
 * Fiscal Registration Not Restartable Exception (#3960)
 *
 * Raised when a registration request would change nothing: the latest attempt
 * is unfinished, yet its job already finished, so there is neither a live job to
 * join nor a dead one to restart.
 *
 * Before #3960 that request answered 202 and did nothing, which an operator
 * reads as "registered" while nothing reached the provider. Refusing it is the
 * honest answer. Mapped to HTTP 409 at the controller boundary.
 *
 * Country- and vendor-agnostic (ADR-042 decision 4).
 *
 * @module libs/core/src/fiscalization/domain/exceptions
 */
export class FiscalRegistrationNotRestartableException extends Error {
  constructor(
    public readonly orderId: string,
    public readonly recordId: string,
  ) {
    super(
      `Fiscal registration ${recordId} for order ${orderId} is unfinished but its job has ` +
        `already finished; nothing was sent. Check the registration before asking again`,
    );
    this.name = 'FiscalRegistrationNotRestartableException';
    Error.captureStackTrace(this, this.constructor);
  }
}
