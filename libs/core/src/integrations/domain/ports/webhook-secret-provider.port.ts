/**
 * Webhook Secret Provider Port
 *
 * Defines the contract for retrieving and invalidating cached webhook secrets.
 * Implemented by infrastructure adapters to provide webhook secret retrieval
 * capabilities. This port abstracts the secret storage implementation, allowing
 * the core domain to verify webhook signatures without depending on specific
 * credential storage.
 *
 * Used in BOTH directions of HMAC-authenticated traffic for a connection:
 *   - **Inbound** — webhook receivers (e.g. `WebhookController`) call
 *     `getSecret(provider, connectionId)` to verify `X-OpenLinker-Signature`
 *     on incoming requests.
 *   - **Outbound** — adapters that POST HMAC-signed bodies to a partner's
 *     module endpoints (e.g. `PrestashopOpenLinkerModuleClient` writing to
 *     the OL PS module's `cartshipping` controller, #516) call
 *     `getSecret(...)` to *sign* outgoing requests. Same secret bytes;
 *     used to compute the signature instead of verifying it.
 *
 * The bidirectional reuse is intentional: rotating the shared secret on
 * either side automatically invalidates BOTH the inbound verification and
 * the outbound signing, keeping them consistent. Don't introduce a separate
 * "outbound" port for this — same secret, same key, opposite verb.
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







