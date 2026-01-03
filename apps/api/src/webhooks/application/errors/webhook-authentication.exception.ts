/**
 * Webhook Authentication Exception
 *
 * Domain exception thrown when webhook signature verification fails.
 * This is an API module domain exception (not core domain).
 *
 * @module apps/api/src/webhooks/application/errors
 */
export class WebhookAuthenticationException extends Error {
  constructor(
    message: string,
    public readonly provider?: string,
    public readonly connectionId?: string,
  ) {
    super(message);
    this.name = 'WebhookAuthenticationException';
    Error.captureStackTrace(this, this.constructor);
  }
}



