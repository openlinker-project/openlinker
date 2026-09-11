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

/**
 * Payment methods Infakt accepts on `invoices.json` (#1303). `'transfer'`
 * 422s unless the seller has a bank account (`bank_account`/`bank_name`)
 * configured on the Infakt side — OL cannot observe or enforce that, so
 * picking `'transfer'` is an explicit per-connection opt-in the operator
 * makes after confirming the prerequisite in their Infakt dashboard.
 */
export const InfaktPaymentMethodValues = ['cash', 'transfer'] as const;
export type InfaktPaymentMethod = (typeof InfaktPaymentMethodValues)[number];

/**
 * Sale-type values inFakt requires on `POST invoices.json` for a non-PL client
 * (#2177). inFakt silently defaults `sale_type` for a PL-country client, so
 * issuance to a PL buyer worked without it; for any other country inFakt
 * rejects the request with 422
 * (`{"errors":{"sale_type":["Proszę określić rodzaj sprzedaży."]}}`) unless
 * the field is present.
 *
 * Only `'service'` is CONFIRMED against inFakt's sandbox (live-tested,
 * exact-lowercase match) — several other spellings (`goods`, `product`,
 * `towar`, `usluga`, `mixed`, case variants) were all rejected, including
 * `'goods'` itself. The correct value for a physical-goods sale was NOT found
 * in that pass, and is deliberately NOT listed here (#2995 review): this
 * union is closed and validated at save time, so a placeholder value an
 * operator could select would pass that gate and then 422 at issuance —
 * converting the very guard meant to catch a malformed shape into a trap.
 * Add the second member (with its own confirmed test coverage) once the real
 * goods value is found — tracked as a follow-up, see the plugin README.
 */
export const InfaktSaleTypeValues = ['service'] as const;
export type InfaktSaleType = (typeof InfaktSaleTypeValues)[number];

/**
 * inFakt API environment (#2174). The neutral choice the FE create wizard and
 * edit form persist on `connection.config.environment`; the adapter factory
 * and connection tester map it to the concrete API base URL via
 * `resolveInfaktBaseUrl`. Mirrors Erli's `ErliEnvironmentValues` convention.
 */
export const InfaktEnvironmentValues = ['sandbox', 'production'] as const;
export type InfaktEnvironment = (typeof InfaktEnvironmentValues)[number];

/**
 * A specific inFakt bank account chosen by the operator (#1303 follow-up).
 * Snapshotted at selection time — the adapter never re-fetches by `id` at
 * invoice-issuance time, so a later edit/deletion of the account directly in
 * inFakt does not affect issuance (accepted staleness risk; see the
 * bank-account-picker implementation plan for the tradeoff).
 */
export interface InfaktBankAccountConfig {
  /** Provider-native account id, kept as a string to match `InvoicingBankAccount.id`. */
  id: string;
  accountNumber: string;
  bankName: string;
}

/** Non-secret config persisted on the connection row. */
export interface InfaktConnectionConfig {
  /**
   * Neutral environment choice (#2174) — `'sandbox' | 'production'`. Resolved
   * to a base URL by `resolveInfaktBaseUrl`; absent falls back to production.
   */
  environment?: InfaktEnvironment;
  /**
   * Legacy free-text base URL override, superseded by {@link InfaktConnectionConfig.environment}
   * (#2174). No longer surfaced on either FE form — kept only so a connection
   * created before the environment select existed keeps resolving to the base
   * URL it was configured with. When present, this always wins over `environment`.
   */
  baseUrl?: string;
  /**
   * Payment method sent on every issued invoice/correction. Defaults to
   * `'cash'` when absent (production-safe, no prerequisite) — see
   * {@link InfaktPaymentMethodValues} for the `'transfer'` prerequisite.
   */
  defaultPaymentMethod?: InfaktPaymentMethod;
  /**
   * Bank account stamped on `'transfer'` invoices (`bank_account`/`bank_name`
   * fields). Ignored when `defaultPaymentMethod` is `'cash'`. Absent even
   * when `defaultPaymentMethod` is `'transfer'` means the operator picked
   * Transfer without a bank account on file — the adapter omits both fields
   * and Infakt is left to reject the invoice as documented in #1303.
   */
  bankAccount?: InfaktBankAccountConfig;
  /**
   * Sale-type sent on EVERY issued invoice/correction (#2177) — applied
   * uniformly, not only for non-PL clients, to match how `defaultPaymentMethod`
   * always applies rather than branching on the buyer's country.
   *
   * There is NO safe universal default: a PL client works today because inFakt
   * silently defaults `sale_type` server-side, and this field defaults to
   * leaving `sale_type` OFF the payload entirely when unset — PL issuance keeps
   * working exactly as before, and non-PL issuance keeps 422ing exactly as
   * before, until the operator configures this explicitly.
   *
   * Compliance caveat: the value asserts the invoice's VAT sale-type
   * classification (goods vs. services). Configuring the wrong one for a given
   * sale misstates that classification on a real fiscal document — this is an
   * explicit operator opt-in for their own catalog composition, never an
   * inference OL can make from a possibly-mixed catalog.
   *
   * Deliberately reachable only through the raw config JSON editor, unlike
   * {@link InfaktConnectionConfig.defaultPaymentMethod} (#2995 review) — see
   * the plugin README for why a structured `<select>` isn't worth adding
   * while the field carries a single confirmed option.
   */
  defaultSaleType?: InfaktSaleType;
}
