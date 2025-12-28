/**
 * PrestaShop Credentials Types
 *
 * Type definitions for PrestaShop WebService API credentials. Credentials are
 * resolved from Connection.credentialsRef via CredentialsResolverPort and never
 * stored directly in the database.
 *
 * @module libs/integrations/prestashop/src/domain/types
 */

/**
 * PrestaShop WebService API credentials
 *
 * Credentials for authenticating with PrestaShop WebService API.
 * Resolved from Connection.credentialsRef via CredentialsResolverPort.
 */
export interface PrestashopCredentials {
  /**
   * PrestaShop WebService API key (required)
   * Used for Basic Authentication: base64(apiKey:)
   */
  webserviceApiKey: string;
}

