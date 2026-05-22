/**
 * InPost Credentials Types
 *
 * The secret half of an InPost connection — the ShipX Bearer API token
 * generated in the InPost Manager portal (Moje Konto → API). Resolved via the
 * host `CredentialsResolverPort` from `connection.credentialsRef`; never
 * logged or returned in responses.
 *
 * @module libs/integrations/inpost/src/domain/types
 */

export interface InpostCredentials {
  /** ShipX Bearer API token (long-lived, portal-generated). */
  apiToken: string;
}
