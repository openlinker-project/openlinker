/**
 * Webhook Decode Exception
 *
 * Domain exception thrown when a (signature-verified) inbound webhook body
 * cannot be decoded into the neutral envelope — i.e. the per-provider decoder
 * returned `reject` (malformed body / missing required fields). The controller
 * maps it to HTTP 400. Distinct from `WebhookAuthenticationException` (401):
 * the request was authentic but its body is unusable. A well-formed-but-not-ours
 * event (`ignore`) is NOT an error — it returns 202 with no publish.
 *
 * @module apps/api/src/webhooks/application/errors
 */
export class WebhookDecodeException extends Error {
  constructor(
    message: string,
    public readonly provider?: string,
    public readonly connectionId?: string,
  ) {
    super(message);
    this.name = 'WebhookDecodeException';
    Error.captureStackTrace(this, this.constructor);
  }
}
