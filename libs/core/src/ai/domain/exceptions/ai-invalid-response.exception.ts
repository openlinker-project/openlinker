/**
 * AI Invalid Response Exception
 *
 * Thrown when the provider returns a response that doesn't conform to the
 * expected shape (e.g. empty `text`, missing usage fields, malformed payload).
 * Indicates a bug in the adapter's response parsing or an unexpected provider
 * change — distinct from a transport-level failure.
 *
 * @module libs/core/src/ai/domain/exceptions
 */
import { AiCompletionError } from './ai-completion.exception';

export class AiInvalidResponseError extends AiCompletionError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AiInvalidResponseError';
    Error.captureStackTrace(this, this.constructor);
  }
}
