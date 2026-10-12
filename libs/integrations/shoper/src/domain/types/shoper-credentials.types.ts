/**
 * Shoper Credentials Types
 *
 * Shape of the credentials payload encrypted at rest in
 * `integration_credentials`.
 *
 * @module libs/integrations/shoper/src/domain/types
 */

export interface ShoperCredentials {
  /**
   * The static Bearer token ("Token API") issued by the shop's own admin panel
   * under "Dodaj integrację" (SPIKE-3638 C1). It is used directly as
   * `Authorization: Bearer {token}` - there is no OAuth exchange for this
   * connection-per-shop model. The accompanying "Client ID" is not needed by
   * any request, so it is not stored.
   */
  readonly token: string;
}
