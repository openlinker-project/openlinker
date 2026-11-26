/**
 * Mirakl Network Exception
 *
 * A transport failure (connection error, timeout, 5xx after the retry budget,
 * an unparseable or oversized body). The message can embed host details from
 * the underlying error, so operator-facing surfaces show a fixed string instead
 * (see `MiraklConnectionTesterAdapter`).
 *
 * Classifier intent: retryable.
 *
 * @module libs/integrations/mirakl/src/domain/exceptions
 */
export class MiraklNetworkException extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'MiraklNetworkException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MiraklNetworkException);
    }
  }
}
