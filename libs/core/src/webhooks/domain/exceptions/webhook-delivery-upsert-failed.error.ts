/**
 * Webhook Delivery Upsert Failed Error
 *
 * Thrown by the webhook delivery repository when an upsert succeeds at the
 * database level but the follow-up read cannot locate the row — indicating an
 * unexpected infrastructure inconsistency.
 *
 * @module libs/core/src/webhooks/domain/exceptions
 */
export class WebhookDeliveryUpsertFailedError extends Error {
  constructor(provider: string, connectionId: string, eventId: string) {
    super(
      `Webhook delivery upsert did not produce a locatable row: provider=${provider}, connectionId=${connectionId}, eventId=${eventId}`,
    );
    this.name = 'WebhookDeliveryUpsertFailedError';
    Error.captureStackTrace(this, this.constructor);
  }
}
