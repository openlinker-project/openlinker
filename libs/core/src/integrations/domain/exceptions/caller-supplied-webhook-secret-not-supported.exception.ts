/**
 * CallerSuppliedWebhookSecretNotSupportedException
 *
 * Thrown by `WebhookSecretService.set` when a caller pastes a webhook secret
 * for a connection whose platform doesn't mint its own secret externally
 * (#1770 review). Only a platform where the secret is generated *outside*
 * OpenLinker (e.g. inFakt, which has no API to accept a server-generated
 * value) is allowed to go through `set` - every other platform's secret is
 * server-rotated via `rotate`, and accepting an arbitrary pasted value would
 * silently desync it from what the platform actually signs with, breaking
 * that channel until someone re-rotates. The API layer maps this to
 * `BadRequestException`.
 *
 * @module libs/core/src/integrations/domain/exceptions
 */
export class CallerSuppliedWebhookSecretNotSupportedException extends Error {
  constructor(public readonly platformType: string) {
    super(
      `Connection platform '${platformType}' does not accept a caller-supplied webhook secret. Use rotate instead.`
    );
    this.name = 'CallerSuppliedWebhookSecretNotSupportedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
