/**
 * Contended Write Error
 *
 * Raised when a write was refused because a peer already holds the
 * serialisation lock for the same target, so nothing was written and nothing
 * failed. The runner treats it as a destination-neutral deferral (#2617): the
 * job is requeued without consuming a retry attempt, under the same bounded
 * deferral budget a throttling destination gets (#2613).
 *
 * Marketplace-neutral on purpose - the guard that raises it lives in core, and
 * a platform classifier could never recognise it.
 *
 * @module libs/core/src/sync/domain/exceptions
 */
export class ContendedWriteError extends Error {
  constructor(
    message: string,
    public readonly target: string
  ) {
    super(message);
    this.name = 'ContendedWriteError';
    Error.captureStackTrace(this, this.constructor);
  }
}
