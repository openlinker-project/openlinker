/**
 * AI Completion Exception
 *
 * Generic domain exception for AI completion failures that do not fall into
 * a more specific category (rate limit, timeout, invalid response). Adapters
 * convert provider-specific errors into this (or one of the subclasses) at
 * the adapter boundary so application code never sees provider error types.
 *
 * @module libs/core/src/ai/domain/exceptions
 */
export class AiCompletionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AiCompletionError';
    Error.captureStackTrace(this, this.constructor);
  }
}
