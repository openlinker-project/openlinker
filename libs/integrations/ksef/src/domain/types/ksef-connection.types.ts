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

/**
 * `TFormaPlatnosci` (FA(3) v1-0E XSD line 1324) — the payment-form enumeration:
 * `1` Gotówka, `2` Karta, `3` Bon, `4` Czek, `5` Kredyt, `6` Przelew,
 * `7` Mobilna. An `xsd:integer` restriction, so the wire value is a
 * numeric-string literal (mirrors the `Fa3TypKorektyValues` precedent in
 * `fa3-xml.types.ts`), not a free-text label.
 *
 * Declared three times by design (connection-config layer here, FA3 schema
 * layer `Fa3FormaPlatnosciValues` in `fa3-schema.types.ts`, FE
 * `KSEF_FORMA_PLATNOSCI_VALUES` in `ksef-setup.schema.ts`) — a future 8th
 * code must be added in all three places. Drift is self-enforcing: the two
 * in-package lists via `ksef-forma-platnosci-drift.spec.ts`, the FE list via
 * the repo-level `scripts/check-ksef-forma-platnosci-drift.mjs` invariant.
 */
export const KsefFormaPlatnosciValues = ['1', '2', '3', '4', '5', '6', '7'] as const;
export type KsefFormaPlatnosci = (typeof KsefFormaPlatnosciValues)[number];

/**
 * Manually-entered bank account (`Platnosc/RachunekBankowy`, #1311). KSeF/FA(3)
 * has no bank-accounts-listing API — this is a plain per-connection config
 * value the operator types in, not live-fetched (unlike inFakt's
 * `BankAccountsReader` capability). `nrRb` mirrors the XSD's own
 * required-others-optional shape (`TRachunekBankowy`, line 1507).
 */
export interface KsefBankAccountConfig {
  nrRb: string;
  bankName?: string;
  swift?: string;
}

/**
 * Connection-level default payment info (#1311) emitted into `Fa/Platnosc`
 * when configured. Every field is independently optional — a Gotówka
 * connection can still declare a default payment term, and a bank account can
 * be set without a payment method. Omitted entirely (not emitted with
 * guessed/empty values) when the connection has nothing configured.
 */
export interface KsefPaymentConfig {
  formaPlatnosci?: KsefFormaPlatnosci;
  bankAccount?: KsefBankAccountConfig;
  /** Days until due, emitted as `Platnosc/TerminPlatnosci/TerminOpis/Ilosc`. */
  paymentTermDays?: number;
  /** Early-payment discount (`Platnosc/Skonto`) — both sub-fields free text. */
  skonto?: { conditions: string; amount: string };
}

/**
 * Connection-level defaults applied to issued-document LINES (#1525) - a
 * top-level config section (following the `payment` #1311 precedent, NOT on
 * `KsefSellerConfig`, which mirrors Podmiot1 identity fields only).
 * `lineUnit` is the free-text unit of measure emitted as `FaWiersz/P_8A` for
 * any line whose neutral `unit` is absent; empty/cleared = P_8A not emitted.
 */
export interface KsefInvoiceDefaultsConfig {
  lineUnit?: string;
  /**
   * IANA timezone (#7) the invoice numbering date variables + period-reset
   * bucket resolve in - the seller's local zone. Absent/empty falls back to
   * `Europe/Warsaw` at adapter construction. Keeping it under invoice defaults
   * (not a credential, not seller identity) mirrors `lineUnit`.
   */
  numberingTimeZone?: string;
}

/** Non-secret config persisted on the connection row. */
export interface KsefConnectionConfig {
  env: KsefEnvironment;
  /** Seller identity for issued documents (C5). Optional until a connection issues. */
  seller?: KsefSellerConfig;
  /** Default payment info emitted into `Fa/Platnosc` (#1311). Optional. */
  payment?: KsefPaymentConfig;
  /** Per-line issuance defaults (#1525). Optional. */
  invoiceDefaults?: KsefInvoiceDefaultsConfig;
}

/**
 * Credentials shape resolved via `CredentialsResolverPort` (C3). `secret` is
 * the raw authentication secret the operator supplies through the connection
 * wizard — for `ksef-token` the KSeF authorization token; for `qualified-seal`
 * a placeholder until C4 defines the seal material shape. The host
 * persists it in the integration credentials store behind `connection.credentialsRef`
 * and hands it back verbatim at adapter construction. There is no second,
 * nested credentials indirection — the resolver call on `credentialsRef` is
 * the only lookup.
 */
export interface KsefCredentials {
  authType: KsefAuthType;
  secret: string;
}
