/**
 * AI Rate Limit Exception
 *
 * Thrown when the upstream AI provider signals a rate-limit (HTTP 429 or
 * provider-specific equivalent). Callers may decide to back off, queue, or
 * surface a user-visible "try again later" message.
 *
 * @module libs/core/src/ai/domain/exceptions
 */
import { AiCompletionError } from './ai-completion.exception';

export class AiRateLimitError extends AiCompletionError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AiRateLimitError';
    Error.captureStackTrace(this, this.constructor);
  }
}
