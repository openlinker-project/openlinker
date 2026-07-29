/**
 * Webhooks DI Tokens
 *
 * Symbol tokens for dependency injection in the webhooks bounded context.
 *
 * @module libs/core/src/webhooks
 */

export const WEBHOOK_DELIVERY_REPOSITORY_TOKEN = Symbol('WebhookDeliveryRepositoryPort');

export const WEBHOOK_AUTH_REJECTION_REPOSITORY_TOKEN = Symbol('WebhookAuthRejectionRepositoryPort');
