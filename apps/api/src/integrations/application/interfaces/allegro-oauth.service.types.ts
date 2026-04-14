/**
 * Allegro OAuth Service Types
 *
 * Shared types for the Allegro OAuth flow. Used by both the service interface
 * and the service implementation.
 *
 * @module apps/api/src/integrations/application/interfaces
 */

/**
 * Allegro OAuth authorization response returned to the caller after
 * generating the authorization URL.
 */
export interface AllegroOAuthAuthorizationResponse {
  authorizationUrl: string;
  state: string;
}

/**
 * Allegro OAuth token response received from the Allegro token endpoint.
 */
export interface AllegroOAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
}

/**
 * OAuth state data stored transiently in Redis during the OAuth flow.
 *
 * clientSecret is stored here temporarily between the connect and callback
 * steps. It is persisted to the credential store and removed from Redis
 * once the token exchange completes.
 */
export interface OAuthStateData {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: string;
  connectionName?: string;
}

/**
 * Data stored in the completed-state Redis marker after a successful callback.
 * Enables idempotent replay responses within the TTL window.
 */
export interface CompletedStateData {
  connectionId: string;
  connectionName: string;
}
