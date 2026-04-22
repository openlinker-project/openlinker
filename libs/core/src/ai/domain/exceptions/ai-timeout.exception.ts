/**
 * AI Timeout Exception
 *
 * Thrown when the adapter's per-call timeout (`OL_AI_TIMEOUT_MS`) elapses
 * before the provider returns. Distinct from generic completion errors so
 * callers can implement timeout-specific retry policies.
 *
 * @module libs/core/src/ai/domain/exceptions
 */
import { AiCompletionError } from './ai-completion.exception';

export class AiTimeoutError extends AiCompletionError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AiTimeoutError';
    Error.captureStackTrace(this, this.constructor);
  }
}
