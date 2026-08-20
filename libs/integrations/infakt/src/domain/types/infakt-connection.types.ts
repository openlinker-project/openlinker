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
}
