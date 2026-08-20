/**
 * eparagony.pl Credentials Types
 *
 * Shape of the credentials payload encrypted at rest in
 * `integration_credentials` and resolved per connection via
 * `CredentialsResolverPort`. Never logged, never echoed onto an operator-facing
 * result.
 *
 * @module libs/integrations/eparagony/src/domain/types
 */

export interface EparagonyCredentials {
  /** OAuth2 client-credentials client id, issued per merchant by the vendor. */
  readonly clientId: string;

  /** OAuth2 client-credentials secret. */
  readonly clientSecret: string;

  /**
   * Value of the `X-Integration-Id` header, of the form `openlinker:<secret>`.
   *
   * Lives with the credentials rather than the config because its second half IS
   * a secret. Optional: the vendor documents the header as mandatory for
   * multi-client integrations and warns that a missing one "may result in the
   * request being blocked", but live probing found it unenforced on reads - so a
   * connection without it still works today and must not be refused at save time.
   */
  readonly integrationId?: string;
}
