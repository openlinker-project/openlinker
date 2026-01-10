/**
 * Allegro Credentials Types
 *
 * Type definitions for Allegro OAuth credentials. Credentials are stored
 * separately from connection config via credentialsRef indirection.
 *
 * This file contains types only (per engineering standards).
 *
 * @module libs/integrations/allegro/src/domain/types
 */

/**
 * Allegro Credentials
 *
 * OAuth credentials for Allegro API access. Retrieved via CredentialsResolverPort
 * using the connection's credentialsRef.
 */
export interface AllegroCredentials {
  /**
   * OAuth access token
   */
  accessToken: string;

  /**
   * OAuth refresh token (optional, for token refresh)
   */
  refreshToken?: string;

  /**
   * Token expiration timestamp (optional)
   */
  expiresAt?: Date | string;
}


