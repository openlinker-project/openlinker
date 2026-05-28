/**
 * OAuth Connection Service Types
 *
 * Neutral shapes for the host's OAuth orchestration (#859). The host owns the
 * platform-agnostic flow (Redis state/CSRF, idempotent-replay markers,
 * credential + connection persistence, the same-account re-auth guard) and
 * delegates the three provider-specific steps to an `OAuthCompletionPort`
 * resolved by `adapterKey`. Platform-specific connection config (e.g. Allegro
 * `environment`, `masterCatalogConnectionId`) rides through `initialConfig` as
 * an opaque blob the host never interprets.
 *
 * @module apps/api/src/integrations/application/interfaces
 */

/**
 * Result of generating the authorization URL — returned to the caller (the
 * platform controller) so it can redirect the operator to the provider.
 */
export interface OAuthAuthorizationResponse {
  authorizationUrl: string;
  state: string;
}

/**
 * Input to `generateAuthorizationUrl`. The platform controller supplies the
 * `adapterKey` (registry lookup), `platformType` (persisted on the credential
 * record + connection), and any platform-specific `initialConfig`.
 */
export interface GenerateAuthorizationUrlInput {
  adapterKey: string;
  platformType: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Optional caller-supplied CSRF state; a random one is minted when absent. */
  state?: string;
  connectionName?: string;
  /**
   * When set, the callback re-authenticates this existing connection in place
   * (rotating its stored credentials and clearing a `needs_reauth` flag) rather
   * than minting a new connection (#819). Re-using the connection preserves all
   * connection-scoped identifier mappings.
   */
  connectionId?: string;
  /** Platform-specific connection-config seed; opaque to the host. */
  initialConfig?: Record<string, unknown>;
}

/**
 * OAuth state persisted transiently in Redis between connect and callback.
 *
 * `clientSecret` is held here only for the duration of the flow; it is folded
 * into the persisted credential blob and the Redis key is consumed on callback.
 */
export interface OAuthStateData {
  /** Resolves the per-platform `OAuthCompletionPort` and stamps the connection. */
  adapterKey: string;
  /** Persisted on the credential record and the created connection. */
  platformType: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  connectionName?: string;
  /** Set on the re-auth-in-place path (#819). */
  connectionId?: string;
  /** Platform-specific connection-config seed forwarded verbatim to the adapter + merged into the connection's config. */
  initialConfig?: Record<string, unknown>;
}

/**
 * Data stored in the completed-state Redis marker after a successful callback.
 * Enables idempotent replay responses within the TTL window.
 */
export interface CompletedStateData {
  connectionId: string;
  connectionName: string;
}
