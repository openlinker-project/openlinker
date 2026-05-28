/**
 * OAuth Connection Service Interface
 *
 * Contract for the host's neutral OAuth orchestration (#859). Owns the
 * platform-agnostic flow — Redis state/CSRF, idempotent-replay markers,
 * credential + connection persistence, and the same-account re-auth guard
 * (#820) — and delegates the provider-specific steps (authorize-URL, code
 * exchange, identity) to an `OAuthCompletionPort` resolved by `adapterKey`
 * through `OAuthCompletionRegistryService`. No platform (Allegro etc.)
 * knowledge crosses this contract.
 *
 * @module apps/api/src/integrations/application/interfaces
 * @see {@link OAuthConnectionService} for the implementation
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type {
  OAuthAuthorizationResponse,
  GenerateAuthorizationUrlInput,
  OAuthStateData,
  CompletedStateData,
} from './oauth-connection.service.types';

export type {
  OAuthAuthorizationResponse,
  GenerateAuthorizationUrlInput,
  OAuthStateData,
  CompletedStateData,
};

export const OAUTH_CONNECTION_SERVICE_TOKEN = Symbol('IOAuthConnectionService');

export interface IOAuthConnectionService {
  /**
   * Build the provider authorization URL (via the resolved adapter) and persist
   * the transient OAuth state to Redis for callback validation.
   */
  generateAuthorizationUrl(
    input: GenerateAuthorizationUrlInput
  ): Promise<OAuthAuthorizationResponse>;

  /**
   * Validate and consume the OAuth state parameter (one-time use). Returns the
   * state data if valid, `null` if missing or expired.
   */
  validateState(state: string): Promise<OAuthStateData | null>;

  /**
   * Complete the authorization: exchange the code for credentials, verify the
   * account identity, run the same-account guard, and persist the connection
   * (create, or re-auth-in-place when the state carries a `connectionId`).
   */
  completeAuthorization(code: string, stateData: OAuthStateData): Promise<Connection>;

  /**
   * Persist a short-lived completed marker after a successful callback. Enables
   * idempotent replay of the callback within the TTL window.
   */
  markStateCompleted(state: string, connectionId: string, connectionName: string): Promise<void>;

  /**
   * Check whether a completed marker exists for the given state. Returns the
   * connection data if found, `null` otherwise. Does not consume the marker.
   */
  checkCompletedState(state: string): Promise<CompletedStateData | null>;
}
