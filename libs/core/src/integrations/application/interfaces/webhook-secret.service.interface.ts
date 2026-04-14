/**
 * Webhook Secret Service Interface
 *
 * @module libs/core/src/integrations/application/interfaces
 */

export interface RotateWebhookSecretResult {
  secret: string;
}

export interface IWebhookSecretService {
  /**
   * Generate a new webhook secret for a connection, persist it encrypted,
   * invalidate any cached value, and return the plaintext exactly once.
   *
   * @throws if the connection does not exist
   */
  rotate(provider: string, connectionId: string, actorUserId?: string): Promise<RotateWebhookSecretResult>;
}
