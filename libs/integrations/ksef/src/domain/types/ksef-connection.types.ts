/**
 * KSeF Connection Types
 *
 * Per-connection non-secret config + credentials shapes for the KSeF plugin.
 * These are adapter-internal (the only place provider-specific terminology is
 * allowed per ADR-026); core never sees them. The config carries the target
 * KSeF environment; credentials carry the authentication mode plus an opaque
 * `secretRef` the host's `CredentialsResolverPort` resolves at adapter boot
 * (C3) — the secret value itself is never stored on the connection.
 *
 * @module libs/integrations/ksef/src/domain/types
 */

/**
 * KSeF target environment. `test`/`demo` are the public sandbox tiers; `prod`
 * is the live clearance system. Pinned as an `as const` union per
 * engineering-standards (no TS enum).
 */
export const KsefEnvironmentValues = ['test', 'demo', 'prod'] as const;
export type KsefEnvironment = (typeof KsefEnvironmentValues)[number];

/**
 * Authentication mode for a KSeF connection. `ksef-token` is the static
 * authorization-token flow; `qualified-seal` is the X.509 qualified-seal
 * signing flow. The concrete credential material lives behind `secretRef`,
 * resolved at adapter construction (C3) — never on the connection row.
 */
export const KsefAuthTypeValues = ['ksef-token', 'qualified-seal'] as const;
export type KsefAuthType = (typeof KsefAuthTypeValues)[number];

/** Non-secret config persisted on the connection row. */
export interface KsefConnectionConfig {
  env: KsefEnvironment;
}

/**
 * Credentials shape resolved via `CredentialsResolverPort` (C3). `secretRef` is
 * an opaque reference (e.g. a vault/secret-store key) — never the secret value
 * itself; validators check only that it is a non-empty string.
 */
export interface KsefCredentials {
  authType: KsefAuthType;
  secretRef: string;
}
