/**
 * Webhook Replay Exception
 *
 * Domain exception thrown when webhook timestamp is outside the allowed
 * replay protection window. This is an API module domain exception (not core domain).
 *
 * @module apps/api/src/webhooks/application/errors
 */
export class WebhookReplayException extends Error {
  constructor(
    message: string,
    public readonly timestamp?: string,
    public readonly skewWindowMs?: number,
  ) {
    super(message);
    this.name = 'WebhookReplayException';
    Error.captureStackTrace(this, this.constructor);
  }
}






