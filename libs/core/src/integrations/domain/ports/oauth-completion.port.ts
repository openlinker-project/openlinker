/**
 * OAuth Completion Port
 *
 * Capability contract for the platform-specific steps of an OAuth2
 * authorization-code flow. Implemented per-platform (today
 * `AllegroOAuthCompletionAdapter`; a future Shopify/eBay adapter would talk to
 * its own provider) and resolved per-connection by the host's
 * `OAuthConnectionService` via `OAuthCompletionRegistryService` indexed by
 * `adapterKey` (#859, mirroring the webhook-provisioning port/registry #583).
 *
 * The host owns everything neutral about the flow — Redis state/CSRF,
 * idempotent-replay markers, credential + connection persistence, and the
 * same-account re-auth guard (#820). This port owns only the three steps that
 * require provider knowledge: building the authorize URL, exchanging the code
 * for a credential blob, and verifying the account identity.
 *
 * @module libs/core/src/integrations/domain/ports
 * @see {@link OAuthCredentialBlob} for the exchange-output contract
 */
import type {
  BuildAuthorizationUrlInput,
  ExchangeCodeInput,
  FetchAccountIdentityInput,
  OAuthAccountIdentity,
  OAuthCredentialBlob,
} from '../types/oauth-completion.types';

export interface OAuthCompletionPort {
  /**
   * Build the provider's authorization-consent URL. Pure and synchronous —
   * the host has already minted and persisted the `state`; the adapter only
   * assembles the URL (endpoint, `client_id`, `response_type`, `redirect_uri`,
   * `state`) from `input` and its `config` seed.
   */
  buildAuthorizationUrl(input: BuildAuthorizationUrlInput): string;

  /**
   * Exchange the authorization code for credentials.
   *
   * Returns the **normalized** credential blob the host persists verbatim and
   * the runtime token-refresh consumer reads back — NOT the raw provider token
   * response. The adapter folds any longer-lived secrets it needs for refresh
   * (e.g. `clientId`/`clientSecret`) into the blob.
   *
   * @throws OAuthCodeExchangeException when the provider rejects the code or
   *   credentials (non-OK token response). The host maps this to a 400. Any
   *   other failure (network/timeout) propagates and the host maps it to a 500.
   */
  exchangeCode(input: ExchangeCodeInput): Promise<OAuthCredentialBlob>;

  /**
   * Verify and return the account identity behind the freshly issued
   * credentials, used to anchor the connection and to power the same-account
   * re-auth guard (#820).
   *
   * Contract: **throws** on any transport/verification failure — the host
   * treats that as fatal to completion (500; the OAuth state is left
   * un-consumed so the operator can retry), so a connection is never anchored
   * to an unverified account. Returns `undefined` **only** for platforms that
   * have no account-identity concept (the host then skips the anchor + guard).
   */
  fetchAccountIdentity(input: FetchAccountIdentityInput): Promise<OAuthAccountIdentity | undefined>;
}
