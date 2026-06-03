/**
 * DPD Polska Credentials Types
 *
 * The secret half of a DPD connection — the HTTP Basic-auth pair for the
 * DPDServices REST API (`Authorization: Basic base64(login:password)`).
 * Resolved via the host `CredentialsResolverPort` from
 * `connection.credentialsRef`; never logged or returned in responses.
 *
 * The payer/master FID account identifiers live in `DpdConnectionConfig`
 * (non-secret, sent in the request body / `X-DPD-FID` header).
 *
 * @module libs/integrations/dpd-polska/src/domain/types
 */

export interface DpdCredentials {
  /** DPDServices Basic-auth login. */
  login: string;
  /** DPDServices Basic-auth password. */
  password: string;
}
