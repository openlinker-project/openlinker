/**
 * KSeF Connection Types
 *
 * Per-connection non-secret config + credentials shapes for the KSeF plugin.
 * These are adapter-internal (the only place provider-specific terminology is
 * allowed per ADR-026); core never sees them. The config carries the target
 * KSeF environment; credentials carry the authentication mode plus the raw
 * `secret` the host's `CredentialsResolverPort` resolves (as the full
 * credentials payload behind `connection.credentialsRef`) at adapter boot
 * (C3) — the secret value itself is never stored on the connection row.
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
 * signing flow. The concrete credential material lives in `KsefCredentials.secret`,
 * resolved at adapter construction (C3) — never on the connection row.
 */
export const KsefAuthTypeValues = ['ksef-token', 'qualified-seal'] as const;
export type KsefAuthType = (typeof KsefAuthTypeValues)[number];

/**
 * Seller identity persisted on the connection row (Podmiot1 — system config,
 * NOT a credential and never per-invoice input). Required for issuance (C5):
 * every FA(3) carries the seller NIP + name + postal address. `countryIso2` is
 * ISO 3166-1 alpha-2; the field names mirror the neutral `BuyerAddress` shape so
 * the adapter can hand it straight to the FA(3) `SellerProfile`.
 */
export interface KsefSellerConfig {
  nip: string;
  name: string;
  address: {
    line1: string;
    line2?: string | null;
    city: string;
    postalCode: string;
    countryIso2: string;
  };
  /**
   * Neutral tax-rate code (an `FA3_TAX_RATE_MAP` key, e.g. `'23'`) applied to
   * any invoice line whose neutral `taxRate` is empty — core has no per-line
   * tax rate to give (ADR-026), so this is the connection's flat fallback.
   * Optional; falls back to the PL standard rate (`DEFAULT_FA3_TAX_RATE`)
   * when absent.
   */
  defaultTaxRate?: string;
}

/** Non-secret config persisted on the connection row. */
export interface KsefConnectionConfig {
  env: KsefEnvironment;
  /** Seller identity for issued documents (C5). Optional until a connection issues. */
  seller?: KsefSellerConfig;
}

/**
 * Credentials shape resolved via `CredentialsResolverPort` (C3). `secret` is
 * the raw authentication secret (KSeF authorization token, or a qualified-seal
 * reference) the operator supplies through the connection wizard; the host
 * persists it in the integration credentials store behind `connection.credentialsRef`
 * and hands it back verbatim at adapter construction. There is no second,
 * nested credentials indirection — the resolver call on `credentialsRef` is
 * the only lookup.
 */
export interface KsefCredentials {
  authType: KsefAuthType;
  secret: string;
}
