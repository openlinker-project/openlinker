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

  /**
   * Persist a caller-supplied webhook secret for a connection (encrypted),
   * invalidating any cached value. Used when the external platform mints the
   * secret and the operator pastes it into OpenLinker (e.g. inFakt, which has
   * no API to accept an externally-generated secret) — the inbound counterpart
   * to `rotate`, whose server-generated value would never match the platform.
   *
   * @throws if the connection does not exist
   */
  set(provider: string, connectionId: string, secret: string, actorUserId?: string): Promise<void>;
}
