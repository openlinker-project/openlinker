/**
 * OAuth Completion Types
 *
 * Neutral input/output shapes for `OAuthCompletionPort` (#859). The host
 * orchestrates the OAuth flow platform-neutrally (Redis state/CSRF/idempotency,
 * credential + connection persistence, the same-account guard) and delegates
 * the three platform-specific steps — authorize-URL construction, code→token
 * exchange, and account-identity verification — to the per-platform adapter
 * resolved through `OAuthCompletionRegistryService`.
 *
 * All three methods receive the opaque, platform-specific `config` seed (e.g.
 * Allegro `environment`); it is forwarded verbatim from the persisted OAuth
 * state and the host never interprets it.
 *
 * @module libs/core/src/integrations/domain/types
 */

/**
 * Opaque credential blob produced by `exchangeCode` and persisted verbatim by
 * the host. Its concrete shape is the adapter's contract with the *runtime*
 * credential consumer (e.g. Allegro's `AllegroTokenRefreshService`), NOT the
 * host — the host stores it and hands it back to `fetchAccountIdentity`
 * without reading any field.
 */
export type OAuthCredentialBlob = Record<string, unknown>;

/**
 * Input to `buildAuthorizationUrl`.
 */
export interface BuildAuthorizationUrlInput {
  clientId: string;
  redirectUri: string;
  /** Opaque CSRF state the host minted and persisted; the adapter echoes it into the URL. */
  state: string;
  /** Platform-specific config seed (e.g. Allegro `environment`). Opaque to the host. */
  config?: Record<string, unknown>;
}

/**
 * Input to `exchangeCode`.
 */
export interface ExchangeCodeInput {
  /** Authorization code returned by the provider to the callback. */
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Platform-specific config seed (e.g. Allegro `environment`). Opaque to the host. */
  config?: Record<string, unknown>;
}

/**
 * Input to `fetchAccountIdentity`. Carries the credential blob just minted by
 * `exchangeCode` plus the same opaque `config` seed (the identity call's
 * endpoint may be environment-dependent, and `environment` lives in `config`,
 * not the credential blob).
 */
export interface FetchAccountIdentityInput {
  credentials: OAuthCredentialBlob;
  config?: Record<string, unknown>;
}

/**
 * Neutral account identity for the authenticated principal behind a freshly
 * issued token. `accountId` is the stable provider-side account id the host
 * persists (as `config.oauthAccountId`) and the same-account re-auth guard
 * (#820) compares against. `label` is an optional human-readable handle
 * (e.g. an Allegro login) used only in operator-facing messages.
 */
export interface OAuthAccountIdentity {
  accountId: string;
  label?: string;
}
