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
   * Report whether a webhook secret is currently resolvable for a
   * provider+connection pair, without throwing when absent. Used by the
   * operator-facing webhook status surface (#1770) to show whether signature
   * verification is configured. Counts both the persisted (DB) secret and the
   * deprecated env-var fallback so the status matches what `getSecret` resolves.
   */
  has(provider: string, connectionId: string): Promise<boolean>;

  /**
   * Invalidate any cached secret for a provider+connection pair.
   * Must be called after rotating the secret so the next read fetches fresh data.
   */
  invalidate(provider: string, connectionId: string): void;
}

/**
 * Canonical credential ref prefix for per-connection webhook secrets.
 *
 * Exported separately from `webhookSecretRef` (#709) so the credentials-
 * encryption migration can dispatch on `row.ref.startsWith(prefix)` against
 * a typed constant rather than a hardcoded string literal — the migration
 * has to identify inner-envelope writers when unwrapping them into the
 * new outer-envelope shape, and a future helper rename must not silently
 * skip that branch.
 */
export const WEBHOOK_SECRET_REF_PREFIX = 'webhook-secret:';

/**
 * Canonical credential ref key for a per-connection webhook secret.
 * Defined here so both the adapter and application layer share one source of truth.
 */
export const webhookSecretRef = (connectionId: string): string =>
  `${WEBHOOK_SECRET_REF_PREFIX}${connectionId}`;







