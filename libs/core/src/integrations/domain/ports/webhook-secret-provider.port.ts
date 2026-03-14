/**
 * Webhook Secret Provider Port
 *
 * Defines the contract for retrieving webhook secrets for signature verification.
 * Implemented by infrastructure adapters to provide webhook secret retrieval
 * capabilities. This port abstracts the secret storage implementation, allowing
 * the core domain to verify webhook signatures without depending on specific
 * credential storage.
 *
 * @module libs/core/src/integrations/domain/ports
 * @see {@link StubWebhookSecretProvider} for the stub implementation
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
}







