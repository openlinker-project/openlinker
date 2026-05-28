/**
 * Allegro OAuth Types
 *
 * Plugin-internal shapes for the Allegro OAuth2 authorization-code flow.
 * Relocated from the host (`apps/api`) into the plugin as part of #859 — the
 * raw Allegro token-endpoint response is an Allegro-API detail that never
 * crosses back to the neutral host (the host sees only the normalized
 * `OAuthCredentialBlob` the adapter returns).
 *
 * @module libs/integrations/allegro/src/domain/types
 */

/**
 * Raw response from Allegro's `POST /auth/oauth/token` endpoint
 * (authorization-code grant). snake_case mirrors the wire format.
 */
export interface AllegroOAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
}
