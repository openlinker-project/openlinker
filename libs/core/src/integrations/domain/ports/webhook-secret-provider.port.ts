/**
 * Webhook Secret Provider Port
 *
 * Defines the contract for retrieving and invalidating cached webhook secrets.
 * Implemented by infrastructure adapters to provide webhook secret retrieval
 * capabilities. This port abstracts the secret storage implementation, allowing
 * the core domain to verify webhook signatures without depending on specific
 * credential storage.
 *
 * @module libs/core/src/integrations/domain/ports
 * @see {@link CredentialsWebhookSecretAdapter} for the production implementation
 */
export interface WebhookSecretProviderPort {
  /**
   * Get webhook secret for a provider and connection
   *
   * @param provider - The provider identifier (e.g., 'prestashop')
   * @param connectionId - The connection identifier (UUID)
   * @returns Promise resolving to the webhook secret
   * @throws Error if secret is not found or cannot be retrieved
   */
  getSecret(provider: string, connectionId: string): Promise<string>;

  /**
   * Invalidate any cached secret for a provider+connection pair.
   * Must be called after rotating the secret so the next read fetches fresh data.
   */
  invalidate(provider: string, connectionId: string): void;
}

/**
 * Canonical credential ref key for a per-connection webhook secret.
 * Defined here so both the adapter and application layer share one source of truth.
 */
export const webhookSecretRef = (connectionId: string): string =>
  `webhook-secret:${connectionId}`;







