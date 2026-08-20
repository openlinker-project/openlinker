/**
 * EparagonyConfigException
 *
 * Raised when a connection cannot be turned into a working client at all -
 * missing credentials, an unusable host override - or when the sale as composed
 * cannot legally be expressed as a receipt (an unresolvable tax rate).
 *
 * `failureMode` is `'rejected'`: nothing crossed the provider boundary, so
 * nothing was registered and re-attempting after the operator fixes the
 * connection is safe.
 *
 * @module libs/integrations/eparagony/src/domain/exceptions
 */
import type { EparagonyFailureMode } from './eparagony-api.error';

export class EparagonyConfigException extends Error {
  readonly failureMode: EparagonyFailureMode = 'rejected';

  constructor(
    message: string,
    /** Short, PII-free operator-facing summary; core persists it verbatim. */
    readonly reason: string,
    readonly connectionId?: string,
  ) {
    super(message);
    this.name = 'EparagonyConfigException';
    Error.captureStackTrace(this, this.constructor);
  }
}
