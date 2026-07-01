/**
 * Infakt Connection Types
 *
 * Per-connection non-secret config + credentials shapes for the Infakt plugin.
 * Mirrors the sibling KSeF plugin's `ksef-connection.types.ts` layout — kept
 * out of the factory file per engineering-standards § Type Definitions in
 * Separate Files.
 *
 * @module libs/integrations/infakt/src/domain/types
 */

/** Credentials shape resolved via `CredentialsResolverPort`. */
export interface InfaktCredentials {
  apiKey: string;
}

/** Non-secret config persisted on the connection row. */
export interface InfaktConnectionConfig {
  baseUrl?: string;
}
