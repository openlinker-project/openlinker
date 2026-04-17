/**
 * Allegro OAuth Service Interface
 *
 * Defines the contract for Allegro OAuth flow operations. Handles OAuth
 * authorization URL generation, token exchange, connection validation,
 * and idempotent callback state management.
 *
 * @module apps/api/src/integrations/application/interfaces
 * @see {@link AllegroOAuthService} for the implementation
 */
import { Connection } from '@openlinker/core/identifier-mapping';
import type { AllegroOAuthAuthorizationResponse, AllegroOAuthTokenResponse, OAuthStateData, CompletedStateData } from './allegro-oauth.service.types';

export type { AllegroOAuthAuthorizationResponse, AllegroOAuthTokenResponse, OAuthStateData, CompletedStateData };

export const ALLEGRO_OAUTH_SERVICE_TOKEN = Symbol('IAllegroOAuthService');

export interface IAllegroOAuthService {
  /**
   * Generate OAuth authorization URL and persist transient state to Redis.
   */
  generateAuthorizationUrl(
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    environment?: string,
    state?: string,
    connectionName?: string,
    masterCatalogConnectionId?: string,
  ): Promise<AllegroOAuthAuthorizationResponse>;

  /**
   * Validate and consume OAuth state parameter (one-time use).
   * Returns state data if valid, null if missing or expired.
   */
  validateState(state: string): Promise<OAuthStateData | null>;

  /**
   * Exchange authorization code for access and refresh tokens.
   */
  exchangeCodeForToken(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    environment?: string,
  ): Promise<AllegroOAuthTokenResponse>;

  /**
   * Validate that a connection's configuration is correct for Allegro.
   */
  validateConnection(connectionId: string): Promise<{ valid: boolean; errors: string[] }>;

  /**
   * Store OAuth credentials in the database and create the Connection entity.
   */
  storeCredentialsAndCreateConnection(
    tokenResponse: AllegroOAuthTokenResponse,
    stateData: OAuthStateData,
  ): Promise<Connection>;

  /**
   * Exchange a refresh token for a new access token.
   */
  refreshToken(
    refreshToken: string,
    clientId: string,
    clientSecret: string,
    environment?: string,
  ): Promise<AllegroOAuthTokenResponse>;

  /**
   * Persist a short-lived completed marker in Redis after a successful callback.
   * Enables idempotent replay of the callback within the TTL window.
   */
  markStateCompleted(
    state: string,
    connectionId: string,
    connectionName: string,
  ): Promise<void>;

  /**
   * Check whether a completed marker exists for the given state.
   * Returns connection data if found, null otherwise. Does not consume the marker.
   */
  checkCompletedState(state: string): Promise<CompletedStateData | null>;
}
