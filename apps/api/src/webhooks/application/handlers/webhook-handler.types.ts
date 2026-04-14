/**
 * Internal types for webhook-to-job handler stream field parsing.
 *
 * @module apps/api/src/webhooks/application/handlers
 */

export interface WebhookPayload {
  objectType?: string;
  externalId?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WebhookMetadata {
  provider?: string;
  connectionId?: string;
  [key: string]: unknown;
}
