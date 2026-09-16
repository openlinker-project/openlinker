/**
 * EparagonyNetworkError
 *
 * Transport-class failure: a timeout, a socket error, an unparseable body, or an
 * exhausted retry budget. ALWAYS `failureMode: 'in-doubt'` and never anything
 * else - by the time a transport failure is observed the request may already have
 * reached the vendor and the document may already exist, so this is exactly the
 * case the fiscal-safe default exists for.
 *
 * The copy is LANE-NEUTRAL (#3192): this class is thrown by both
 * `EparagonyFiscalizationAdapter` (where what is in doubt is whether a sale was
 * registered) and `EparagonyInvoicingAdapter.pollToSettledIssuance` (where it is
 * whether an invoice was issued), so it names neither.
 *
 * @module libs/integrations/eparagony/src/domain/exceptions
 */
import type { EparagonyFailureMode } from './eparagony-api.error';

export class EparagonyNetworkError extends Error {
  readonly failureMode: EparagonyFailureMode = 'in-doubt';

  /**
   * Operator-facing summary. Core only reads `reason` for a terminal rejection,
   * so this is carried for symmetry and for the connection tester, not because
   * core will render it.
   */
  readonly reason =
    'The provider could not be reached or did not answer in time; the document may or may not have been issued.';

  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'EparagonyNetworkError';
    Error.captureStackTrace(this, this.constructor);
  }
}
